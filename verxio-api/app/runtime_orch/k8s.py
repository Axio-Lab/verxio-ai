"""Kubernetes RuntimeManager stub (Phase 6).

Implements the protocol surface and dry-run manifests. Live cluster ops require
VERXIO_K8S_ENABLED=true and a configured kube context / in-cluster config.
"""

from __future__ import annotations

import os
from typing import Any

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

    def pod_name(self, runtime: RuntimeInstance) -> str:
        raw = runtime.container_name or f"verxio-{runtime.workspace_id}-{runtime.agent_id}"
        return raw.lower().replace("_", "-")[:63]

    def render_pod_manifest(self, runtime: RuntimeInstance, *, extra_env: dict[str, str] | None = None) -> dict[str, Any]:
        env = [
            {"name": "HERMES_DASHBOARD", "value": "1"},
            {"name": "HERMES_DASHBOARD_HOST", "value": "0.0.0.0"},
            {"name": "HERMES_DASHBOARD_PORT", "value": "9119"},
            {"name": "HERMES_DASHBOARD_INSECURE", "value": "1"},
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
                    }
                ],
            },
        }

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
        assert_transition(runtime.status, RuntimeStatus.STARTING)
        # Live client wiring lands with kind/k3d CI; keep dry-run safe for now.
        raise RuntimeManagerError("K8s live apply not enabled in this build — use render_pod_manifest / kind CI")

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        self._require_enabled()
        raise RuntimeManagerError("K8s live delete not enabled in this build")

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        await self.stop(runtime)
        return await self.start(runtime, extra_env=extra_env, wait_ready=True)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        save_runtime(runtime, status=RuntimeStatus.DRAINING)
        return await self.stop(runtime)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        name = self.pod_name(runtime)
        return f"http://{name}.{self.namespace}.svc.cluster.local:9119"

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        if runtime.status == RuntimeStatus.RUNNING:
            return True, "ok"
        return False, f"status={runtime.status}"

    def supports_publish_ports(self) -> bool:
        return False
