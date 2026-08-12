"""Kubernetes RuntimeManager — live apply when VERXIO_K8S_ENABLED=true."""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import socket
import time
from typing import Any

import httpx

from app import db
from app.control_plane import now_iso, save_runtime
from app.models import RuntimeInstance
from app.runtime_orch.manager import RuntimeManagerError
from app.runtime_orch.states import RuntimeStatus, assert_transition

logger = logging.getLogger(__name__)


class K8sRuntimeManager:
    name = "k8s"

    def __init__(
        self,
        *,
        namespace: str | None = None,
        image: str | None = None,
    ) -> None:
        self.namespace = (namespace or os.getenv("VERXIO_K8S_NAMESPACE", "verxio-runtimes")).strip()
        self.image = image or os.getenv("VERXIO_HERMES_IMAGE", "nousresearch/hermes-agent:latest")
        self.enabled = os.getenv("VERXIO_K8S_ENABLED", "false").strip().lower() in {"1", "true", "yes", "on"}
        self.ready_timeout = float(os.getenv("VERXIO_K8S_READY_TIMEOUT_SECONDS", "180") or "180")
        # cluster: Service DNS (API must be in-cluster)
        # hostPort: kind/hybrid — reach via node IP + hostPort (default for local)
        # podIP: direct pod IP (only when CNI routes to the API)
        self.connect_mode = (os.getenv("VERXIO_K8S_CONNECT_MODE") or "hostPort").strip().lower()
        self.node_host = (os.getenv("VERXIO_K8S_NODE_HOST") or "verxio-control-plane").strip()
        self._core = None

    def pod_name(self, runtime: RuntimeInstance) -> str:
        raw = runtime.container_name or f"verxio-{runtime.workspace_id}-{runtime.agent_id}"
        return raw.lower().replace("_", "-")[:63]

    def _resolve_dashboard_token(self, runtime: RuntimeInstance) -> str:
        token_row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime.id,))
        token = str(token_row.get("dashboard_token") or "") if token_row else ""
        if token:
            return token
        return secrets.token_urlsafe(32)

    def _host_port_for(self, runtime: RuntimeInstance) -> int:
        """Stable hostPort in the same range as local-docker published ports."""
        start = int(os.getenv("VERXIO_DASHBOARD_PORT_START", "19119") or "19119")
        # Stable offset from runtime id so wake/restart reuse the same node port.
        digest = sum(ord(c) for c in runtime.id) % 2000
        return start + digest

    def render_pod_manifest(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        dashboard_token: str,
        host_port: int | None = None,
    ) -> dict[str, Any]:
        env = [
            {"name": "HERMES_DASHBOARD", "value": "1"},
            {"name": "HERMES_DASHBOARD_HOST", "value": "0.0.0.0"},
            {"name": "HERMES_DASHBOARD_PORT", "value": "9119"},
            {"name": "HERMES_DASHBOARD_INSECURE", "value": "1"},
            {"name": "HERMES_DASHBOARD_SESSION_TOKEN", "value": dashboard_token},
            {"name": "VERXIO_RUNTIME_TOKEN", "value": dashboard_token},
            {"name": "TERMINAL_CWD", "value": "/workspace"},
            {"name": "HERMES_WRITE_SAFE_ROOT", "value": ""},
            {"name": "HERMES_MEDIA_ALLOW_DIRS", "value": "/workspace"},
        ]
        for key, value in sorted((extra_env or {}).items()):
            if key in {
                "HERMES_DASHBOARD",
                "HERMES_DASHBOARD_HOST",
                "HERMES_DASHBOARD_PORT",
                "HERMES_DASHBOARD_INSECURE",
                "HERMES_DASHBOARD_SESSION_TOKEN",
                "VERXIO_RUNTIME_TOKEN",
            }:
                continue
            env.append({"name": key, "value": value})

        name = self.pod_name(runtime)
        port_spec: dict[str, Any] = {"containerPort": 9119, "name": "dashboard"}
        if self.connect_mode == "hostport" and host_port is not None:
            port_spec["hostPort"] = int(host_port)

        # Hermes only allowlists /api/status for unauthenticated probes (not /api/health).
        readiness = {
            "httpGet": {"path": "/api/status", "port": 9119},
            "initialDelaySeconds": int(os.getenv("VERXIO_K8S_READINESS_DELAY", "15") or "15"),
            "periodSeconds": 5,
            "timeoutSeconds": 3,
            "failureThreshold": 36,
        }

        return {
            "apiVersion": "v1",
            "kind": "Pod",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": {
                    "app": "verxio-runtime",
                    "verxio.io/runtime-id": runtime.id,
                    "verxio.io/workspace-id": runtime.workspace_id,
                    "verxio.io/agent-id": runtime.agent_id,
                },
            },
            "spec": {
                # Restart if dashboard exits during boot; Never caused Failed pods + 409 races.
                "restartPolicy": "Always",
                "containers": [
                    {
                        "name": "hermes",
                        "image": self.image,
                        "imagePullPolicy": os.getenv("VERXIO_K8S_IMAGE_PULL_POLICY", "IfNotPresent"),
                        "args": ["gateway", "run"],
                        "ports": [port_spec],
                        "env": env,
                        "readinessProbe": readiness,
                        "resources": {
                            "requests": {
                                "cpu": os.getenv("VERXIO_K8S_CPU_REQUEST", "250m"),
                                "memory": os.getenv("VERXIO_K8S_MEMORY_REQUEST", "1Gi"),
                            },
                            "limits": {
                                "cpu": os.getenv("VERXIO_K8S_CPU_LIMIT", "2"),
                                "memory": os.getenv("VERXIO_K8S_MEMORY_LIMIT", "4Gi"),
                            },
                        },
                    }
                ],
            },
        }

    def render_service_manifest(self, runtime: RuntimeInstance) -> dict[str, Any]:
        name = self.pod_name(runtime)
        return {
            "apiVersion": "v1",
            "kind": "Service",
            "metadata": {
                "name": name,
                "namespace": self.namespace,
                "labels": {
                    "app": "verxio-runtime",
                    "verxio.io/runtime-id": runtime.id,
                },
            },
            "spec": {
                "selector": {
                    "verxio.io/runtime-id": runtime.id,
                },
                "ports": [{"name": "dashboard", "port": 9119, "targetPort": 9119}],
            },
        }

    def _client(self):
        if self._core is not None:
            return self._core
        try:
            from kubernetes import client, config
        except ImportError as exc:
            raise RuntimeManagerError(
                "kubernetes package is required for k8s manager. Install verxio-api[k8s]."
            ) from exc
        try:
            config.load_incluster_config()
        except Exception:
            config.load_kube_config()
        self._core = client.CoreV1Api()
        return self._core

    def _require_enabled(self) -> None:
        if not self.enabled:
            raise RuntimeManagerError(
                "K8s runtime manager is disabled. Set VERXIO_K8S_ENABLED=true and configure cluster access."
            )

    def _wait_pod_gone(self, core: Any, name: str, timeout: float = 60.0) -> None:
        from kubernetes.client.rest import ApiException

        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                core.read_namespaced_pod(name=name, namespace=self.namespace)
            except ApiException as exc:
                if exc.status == 404:
                    return
                raise
            time.sleep(1.0)
        raise RuntimeManagerError(f"K8s pod {name} still exists after delete wait")

    def _dashboard_url(self, *, name: str, host_port: int | None) -> str:
        mode = self.connect_mode
        if mode == "hostport":
            if host_port is None:
                raise RuntimeManagerError("hostPort connect mode requires a host_port")
            host = self.node_host
            try:
                host = socket.gethostbyname(self.node_host)
            except OSError:
                pass
            return f"http://{host}:{host_port}"
        if mode == "podip":
            # Filled after pod is scheduled; provisional Service DNS until then.
            return f"http://{name}.{self.namespace}.svc.cluster.local:9119"
        return f"http://{name}.{self.namespace}.svc.cluster.local:9119"

    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance:
        self._require_enabled()
        if runtime.status != RuntimeStatus.STARTING:
            assert_transition(runtime.status, RuntimeStatus.STARTING)
        save_runtime(runtime, status=RuntimeStatus.STARTING, last_error=None, manager=self.name)

        dashboard_token = self._resolve_dashboard_token(runtime)
        host_port = self._host_port_for(runtime) if self.connect_mode == "hostport" else None
        manifest = self.render_pod_manifest(
            runtime,
            extra_env=extra_env,
            dashboard_token=dashboard_token,
            host_port=host_port,
        )
        service = self.render_service_manifest(runtime)
        name = self.pod_name(runtime)
        core = self._client()

        def _apply() -> str:
            """Create or reuse pod/service. Returns 'reused' | 'created'."""
            from kubernetes.client.rest import ApiException

            # Idempotent wake: dashboard polls call start(wait_ready=False) often.
            # Never delete a live/booting pod — that caused start/kill loops.
            try:
                existing = core.read_namespaced_pod(name=name, namespace=self.namespace)
                phase = str(getattr(getattr(existing, "status", None), "phase", "") or "")
                deleting = bool(getattr(getattr(existing, "metadata", None), "deletion_timestamp", None))
                if deleting:
                    self._wait_pod_gone(core, name)
                elif phase in {"", "Pending", "Running"}:
                    # Empty phase = just created / not yet reported — never replace.
                    try:
                        core.read_namespaced_service(name=name, namespace=self.namespace)
                    except ApiException as exc:
                        if exc.status == 404:
                            try:
                                core.create_namespaced_service(namespace=self.namespace, body=service)
                            except ApiException as create_exc:
                                if create_exc.status != 409:
                                    raise RuntimeManagerError(
                                        f"K8s create service failed: {create_exc.status} {create_exc.reason}"
                                    ) from create_exc
                        else:
                            raise RuntimeManagerError(f"K8s read service failed: {exc.status}") from exc
                    return "reused"
                elif phase in {"Failed", "Succeeded", "Unknown"}:
                    try:
                        core.delete_namespaced_pod(name=name, namespace=self.namespace)
                    except ApiException as exc:
                        if exc.status not in {404, 409}:
                            raise RuntimeManagerError(f"K8s delete pod failed: {exc.status}") from exc
                    self._wait_pod_gone(core, name)
                else:
                    # Unexpected phase — keep the pod rather than thrash.
                    return "reused"
            except ApiException as exc:
                if exc.status != 404:
                    raise RuntimeManagerError(f"K8s read pod failed: {exc.status}") from exc

            try:
                core.create_namespaced_pod(namespace=self.namespace, body=manifest)
            except ApiException as exc:
                raise RuntimeManagerError(f"K8s create pod failed: {exc.status} {exc.reason}") from exc
            try:
                core.create_namespaced_service(namespace=self.namespace, body=service)
            except ApiException as exc:
                if exc.status != 409:
                    raise RuntimeManagerError(f"K8s create service failed: {exc.status} {exc.reason}") from exc
            return "created"

        try:
            await asyncio.to_thread(_apply)
        except RuntimeManagerError:
            save_runtime(runtime, status=RuntimeStatus.ERROR, last_error="K8s create failed")
            raise

        dashboard_url = self._dashboard_url(name=name, host_port=host_port)
        started = save_runtime(
            runtime,
            status=RuntimeStatus.STARTING,
            container_id=name,
            container_name=name,
            image=self.image,
            dashboard_url=dashboard_url,
            dashboard_token=dashboard_token,
            last_started_at=now_iso(),
            last_error=None,
            manager=self.name,
            external_ref=name,
        )
        if self.connect_mode == "podip":
            started = await self._rewrite_pod_ip_url(started)
        if not wait_ready:
            return started
        return await self._wait_ready(started)

    async def _rewrite_pod_ip_url(self, runtime: RuntimeInstance) -> RuntimeInstance:
        name = self.pod_name(runtime)
        core = self._client()

        def _ip() -> str | None:
            from kubernetes.client.rest import ApiException

            try:
                pod = core.read_namespaced_pod(name=name, namespace=self.namespace)
            except ApiException:
                return None
            return getattr(getattr(pod, "status", None), "pod_ip", None)

        for _ in range(30):
            ip = await asyncio.to_thread(_ip)
            if ip:
                return save_runtime(runtime, dashboard_url=f"http://{ip}:9119")
            await asyncio.sleep(1.0)
        return runtime

    async def _wait_ready(self, runtime: RuntimeInstance) -> RuntimeInstance:
        deadline = time.monotonic() + self.ready_timeout
        last = "waiting"
        while time.monotonic() < deadline:
            if self.connect_mode == "podip" and "svc.cluster.local" in (runtime.dashboard_url or ""):
                runtime = await self._rewrite_pod_ip_url(runtime)
            ok, last = await self.health(runtime)
            if ok:
                return save_runtime(runtime, status=RuntimeStatus.RUNNING, last_error=None)
            await asyncio.sleep(2.0)
        return save_runtime(runtime, status=RuntimeStatus.STARTING, last_error=f"K8s ready timeout: {last}")

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        self._require_enabled()
        name = runtime.container_name or self.pod_name(runtime)
        core = self._client()

        def _delete() -> None:
            from kubernetes.client.rest import ApiException

            for delete_fn in (
                lambda: core.delete_namespaced_pod(name=name, namespace=self.namespace),
                lambda: core.delete_namespaced_service(name=name, namespace=self.namespace),
            ):
                try:
                    delete_fn()
                except ApiException as exc:
                    if exc.status != 404:
                        raise RuntimeManagerError(f"K8s delete failed: {exc.status}") from exc

        try:
            await asyncio.to_thread(_delete)
        except RuntimeManagerError:
            return save_runtime(runtime, status=RuntimeStatus.ERROR, last_error="K8s delete failed")
        return save_runtime(runtime, status=RuntimeStatus.STOPPED, last_error=None)

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        await self.stop(runtime)
        return await self.start(runtime, extra_env=extra_env, wait_ready=True)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        draining = save_runtime(runtime, status=RuntimeStatus.DRAINING)
        return await self.stop(draining)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        return runtime.dashboard_url or self._dashboard_url(
            name=self.pod_name(runtime),
            host_port=self._host_port_for(runtime) if self.connect_mode == "hostport" else None,
        )

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        base = await self.address(runtime)
        if not base:
            return False, "No address"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                # /api/status is in Hermes PUBLIC_API_PATHS; /api/health is gated.
                resp = await client.get(f"{base.rstrip('/')}/api/status")
            if resp.status_code < 400:
                return True, "ok"
            return False, f"status {resp.status_code}"
        except Exception as exc:
            return False, str(exc)

    def supports_publish_ports(self) -> bool:
        return self.connect_mode == "hostport"
