"""Worker-pool runtime manager: no per-user containers."""

from __future__ import annotations

import os
from urllib.parse import urljoin

from app.control_plane import now_iso, save_runtime
from app.homes import restore_home
from app.infra.redis import STREAM_ATTACH, enqueue, lookup_holder, try_acquire_lease, worker_id
from app.models import RuntimeInstance
from app.runtime_orch.states import RuntimeStatus


class PoolRuntimeManager:
    name = "pool"

    def __init__(self) -> None:
        self.worker_base = os.getenv("VERXIO_WORKER_BASE_URL", "http://verxio-agent-worker:9119").rstrip("/")

    def _tenant_key(self, runtime: RuntimeInstance) -> str:
        return f"{runtime.workspace_id}:{runtime.agent_id}"

    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance:
        restore_home(runtime, only_if_missing=True)
        holder = lookup_holder(f"tenant:{self._tenant_key(runtime)}")
        if holder is None:
            enqueue(
                STREAM_ATTACH,
                {
                    "workspace_id": runtime.workspace_id,
                    "agent_id": runtime.agent_id,
                    "tenant_id": runtime.tenant_id,
                    "hermes_home_path": runtime.hermes_home_path,
                    "workspace_path": runtime.workspace_path,
                },
            )
        dashboard = self._dashboard_url(runtime)
        return save_runtime(
            runtime,
            status=RuntimeStatus.RUNNING if wait_ready else RuntimeStatus.STARTING,
            manager=self.name,
            dashboard_url=dashboard,
            last_started_at=now_iso(),
            last_error=None,
            external_ref=holder or worker_id(),
        )

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        return save_runtime(runtime, status=RuntimeStatus.STOPPED, last_error=None)

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        await self.stop(runtime)
        return await self.start(runtime, extra_env=extra_env)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        from app.homes import sync_home

        sync_home(runtime)
        return await self.stop(runtime)

    async def address(self, runtime: RuntimeInstance) -> str | None:
        return self._dashboard_url(runtime)

    async def webhook_address(self, runtime: RuntimeInstance) -> str | None:
        return None

    async def api_server_address(self, runtime: RuntimeInstance) -> str | None:
        return None

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        holder = lookup_holder(f"tenant:{self._tenant_key(runtime)}")
        if holder:
            return True, f"Tenant leased by {holder}"
        return True, "Pool manager is ready; tenant will attach on demand."

    def supports_publish_ports(self) -> bool:
        return False

    def _dashboard_url(self, runtime: RuntimeInstance) -> str:
        tenant = self._tenant_key(runtime)
        return urljoin(self.worker_base + "/", f"p/{tenant}/")
