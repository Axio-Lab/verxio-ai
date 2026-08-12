"""Kubernetes RuntimeManager — live apply when VERXIO_K8S_ENABLED=true."""

from __future__ import annotations

import asyncio
import os
import time
from typing import Any

import httpx

from app.control_plane import now_iso, save_runtime
from app.models import RuntimeInstance
from app.runtime_orch.manager import RuntimeManagerError
from app.runtime_orch.states import RuntimeStatus, assert_transition


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
        self.ready_timeout = float(os.getenv("VERXIO_K8S_READY_TIMEOUT_SECONDS", "120") or "120")
        self._core = None

    def pod_name(self, runtime: RuntimeInstance) -> str:
        raw = runtime.container_name or f"verxio-{runtime.workspace_id}-{runtime.agent_id}"
        return raw.lower().replace("_", "-")[:63]

    def render_pod_manifest(self, runtime: RuntimeInstance, *, extra_env: dict[str, str] | None = None) -> dict[str, Any]:
        env = [
            {"name": "HERMES_DASHBOARD", "value": "1"},
            {"name": "HERMES_DASHBOARD_HOST", "value": "0.0.0.0"},
            {"name": "HERMES_DASHBOARD_PORT", "value": "9119"},
            {"name": "HERMES_DASHBOARD_INSECURE", "value": "1"},
            {"name": "TERMINAL_CWD", "value": "/workspace"},
        ]
        for key, value in sorted((extra_env or {}).items()):
            env.append({"name": key, "value": value})
        name = self.pod_name(runtime)
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
                "restartPolicy": "Never",
                "containers": [
                    {
                        "name": "hermes",
                        "image": self.image,
                        "args": ["gateway", "run"],
                        "ports": [{"containerPort": 9119, "name": "dashboard"}],
                        "env": env,
                        "readinessProbe": {
                            "httpGet": {"path": "/api/health", "port": 9119},
                            "initialDelaySeconds": 5,
                            "periodSeconds": 5,
                        },
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

        manifest = self.render_pod_manifest(runtime, extra_env=extra_env)
        name = self.pod_name(runtime)
        core = self._client()

        def _apply() -> None:
            from kubernetes.client.rest import ApiException

            try:
                core.read_namespaced_pod(name=name, namespace=self.namespace)
                core.delete_namespaced_pod(name=name, namespace=self.namespace)
                # Brief wait for deletion.
                time.sleep(2)
            except Exception:
                pass
            try:
                core.create_namespaced_pod(namespace=self.namespace, body=manifest)
            except ApiException as exc:
                raise RuntimeManagerError(f"K8s create pod failed: {exc.status} {exc.reason}") from exc

        try:
            await asyncio.to_thread(_apply)
        except RuntimeManagerError:
            save_runtime(runtime, status=RuntimeStatus.ERROR, last_error="K8s create failed")
            raise

        dashboard_url = f"http://{name}.{self.namespace}.svc.cluster.local:9119"
        started = save_runtime(
            runtime,
            status=RuntimeStatus.STARTING,
            container_id=name,
            container_name=name,
            image=self.image,
            dashboard_url=dashboard_url,
            last_started_at=now_iso(),
            last_error=None,
            manager=self.name,
            external_ref=name,
        )
        if not wait_ready:
            return started
        return await self._wait_ready(started)

    async def _wait_ready(self, runtime: RuntimeInstance) -> RuntimeInstance:
        deadline = time.monotonic() + self.ready_timeout
        last = "waiting"
        while time.monotonic() < deadline:
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

            try:
                core.delete_namespaced_pod(name=name, namespace=self.namespace)
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
        return runtime.dashboard_url or f"http://{self.pod_name(runtime)}.{self.namespace}.svc.cluster.local:9119"

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        base = await self.address(runtime)
        if not base:
            return False, "No address"
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                resp = await client.get(f"{base.rstrip('/')}/api/health")
            if resp.status_code < 400:
                return True, "ok"
            return False, f"health {resp.status_code}"
        except Exception as exc:
            return False, str(exc)

    def supports_publish_ports(self) -> bool:
        return False
