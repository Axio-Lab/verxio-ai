"""Local Docker RuntimeManager — wraps existing runtime_manager.py."""

from __future__ import annotations

import os

from app.models import RuntimeInstance
from app.runtime_orch.states import RuntimeStatus, assert_transition


class LocalDockerRuntimeManager:
    name = "local-docker"

    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance:
        from app import runtime_manager

        assert_transition(runtime.status, RuntimeStatus.STARTING)
        return await runtime_manager.start_runtime(runtime, extra_env=extra_env, wait_ready=wait_ready)

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        from app import runtime_manager

        return await runtime_manager.stop_runtime_async(runtime)

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        from app import runtime_manager

        return await runtime_manager.restart_runtime(runtime, extra_env=extra_env)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        from app.control_plane import save_runtime
        from app.runtime_orch.artifacts_store import get_artifact_store

        draining = save_runtime(runtime, status=RuntimeStatus.DRAINING)
        # Checkpoint hermes-home before stop so wake can restore on ephemeral nodes.
        try:
            store = get_artifact_store()
            key = f"runtimes/{draining.workspace_id}/{draining.agent_id}/hermes-home"
            from pathlib import Path

            home = Path(draining.hermes_home_path)
            if home.exists():
                store.put_directory(key, home)
        except Exception:
            # Drain must still stop even if snapshot fails.
            pass
        return await self.stop(draining)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        from app.runtime_manager import runtime_dashboard_base_url

        return runtime_dashboard_base_url(runtime, ensure_network=True)

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        from app.runtime_manager import runtime_health

        return await runtime_health(runtime)

    def supports_publish_ports(self) -> bool:
        # Prefer DNS-only when on compose network; host ports optional.
        return os.getenv("VERXIO_RUNTIME_PUBLISH_PORTS", "true").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
