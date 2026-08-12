"""Local Docker RuntimeManager — wraps existing runtime_manager.py."""

from __future__ import annotations

import os

from app.control_plane import save_runtime
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

        # Allow re-entry from stopped/error/draining/running(unhealthy).
        if runtime.status != RuntimeStatus.STARTING:
            assert_transition(runtime.status, RuntimeStatus.STARTING)
        started = await runtime_manager.start_runtime(runtime, extra_env=extra_env, wait_ready=wait_ready)
        return save_runtime(started, manager=self.name)

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
        # Checkpoint is performed by lifecycle.drain_runtime before this call.
        draining = save_runtime(runtime, status=RuntimeStatus.DRAINING)
        return await self.stop(draining)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        from app.runtime_manager import runtime_dashboard_base_url

        return runtime_dashboard_base_url(runtime, ensure_network=True)

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        from app.runtime_manager import runtime_health

        return await runtime_health(runtime)

    def supports_publish_ports(self) -> bool:
        return os.getenv("VERXIO_RUNTIME_PUBLISH_PORTS", "true").strip().lower() in {
            "1",
            "true",
            "yes",
            "on",
        }
