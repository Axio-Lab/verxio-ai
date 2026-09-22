"""Worker-pool runtime manager: no per-user containers.

A tenant "starts" by being attached to a live worker. The manager:

1. seals the tenant's runtime env (hosted keys, dashboard token, control-plane
   URLs) so the worker can materialise ``.env``;
2. enqueues an attach and waits for a worker to take the tenant lease;
3. resolves the lease holder's advertised dashboard/api URLs so the API can
   proxy the dashboard (``/p/{tenant}/``) and forward webhooks.

There is nothing to stop: ``stop``/``drain`` release the tenant so the
worker syncs the home and drops the profile.
"""

from __future__ import annotations

import asyncio
import logging
import os
import secrets
import time
from typing import Any
from urllib.parse import urljoin

from app import db
from app.control_plane import now_iso, save_runtime
from app.infra.redis import (
    STREAM_ATTACH,
    enqueue,
    lookup_holder,
    lookup_tenant_holder,
    publish,
    release_lease,
    tenant_lease_key,
    worker_control_channel,
)
from app.models import RuntimeInstance
from app.runtime_orch.states import RuntimeStatus

logger = logging.getLogger(__name__)


def _attach_timeout_seconds() -> float:
    raw = os.getenv("VERXIO_POOL_ATTACH_TIMEOUT_SECONDS", "45").strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 45.0


def tenant_key(runtime: RuntimeInstance) -> str:
    return f"{runtime.workspace_id}:{runtime.agent_id}"


def _tenant_dashboard_url(base: str, runtime: RuntimeInstance) -> str:
    return urljoin(base.rstrip("/") + "/", f"p/{tenant_key(runtime)}/")


def pool_dashboard_token() -> str:
    """Session token the shared Hermes dashboard on pool workers expects."""
    return (
        os.getenv("VERXIO_POOL_DASHBOARD_TOKEN", "").strip()
        or os.getenv("HERMES_DASHBOARD_SESSION_TOKEN", "").strip()
        or os.getenv("VERXIO_INTERNAL_TOKEN", "").strip()
    )


class PoolRuntimeManager:
    name = "pool"

    # -------------------------------------------------------------- helpers
    def holder(self, runtime: RuntimeInstance) -> dict[str, Any] | None:
        return lookup_tenant_holder(runtime.workspace_id, runtime.agent_id)

    def _enqueue_attach(self, runtime: RuntimeInstance) -> None:
        enqueue(
            STREAM_ATTACH,
            {
                "workspace_id": runtime.workspace_id,
                "agent_id": runtime.agent_id,
                "tenant_id": runtime.tenant_id,
                "runtime_id": runtime.id,
            },
        )

    def _seal_env(self, runtime: RuntimeInstance, extra_env: dict[str, str] | None) -> str:
        from app.runtime_manager import _runtime_container_env
        from app.tenant_env import save_tenant_env

        token_row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime.id,))
        dashboard_token = str(token_row.get("dashboard_token") or "") if token_row else ""
        if not dashboard_token:
            dashboard_token = secrets.token_urlsafe(32)
        env = _runtime_container_env(runtime, extra_env)
        env["VERXIO_RUNTIME_TOKEN"] = dashboard_token
        composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
        if composio_api_key:
            env["COMPOSIO_API_KEY"] = composio_api_key
        save_tenant_env(runtime.workspace_id, runtime.agent_id, env)
        return dashboard_token

    async def _wait_for_holder(self, runtime: RuntimeInstance, timeout: float) -> dict[str, Any] | None:
        deadline = time.monotonic() + timeout
        delay = 0.25
        while True:
            holder = await asyncio.to_thread(self.holder, runtime)
            if holder:
                return holder
            if time.monotonic() >= deadline:
                return None
            await asyncio.sleep(delay)
            delay = min(delay * 1.5, 2.0)

    # ------------------------------------------------------------ lifecycle
    async def start(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
        wait_ready: bool = True,
    ) -> RuntimeInstance:
        dashboard_token = await asyncio.to_thread(self._seal_env, runtime, extra_env)
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder is None:
            await asyncio.to_thread(self._enqueue_attach, runtime)
            starting = save_runtime(
                runtime,
                status=RuntimeStatus.STARTING,
                manager=self.name,
                dashboard_token=dashboard_token,
                last_started_at=now_iso(),
                last_error="Attaching to an agent worker.",
            )
            if not wait_ready:
                return starting
            holder = await self._wait_for_holder(runtime, _attach_timeout_seconds())
            if holder is None:
                return save_runtime(
                    starting,
                    status=RuntimeStatus.STARTING,
                    last_error="No agent worker picked up the tenant yet. Retrying.",
                )
        # Worker may have seen a stale .env when it attached before we sealed;
        # tell it to refresh (it re-reads tenant_runtime_env on heartbeat too).
        publish(
            worker_control_channel(str(holder["worker"])),
            {"op": "env_updated", "workspace_id": runtime.workspace_id, "agent_id": runtime.agent_id},
        )
        return save_runtime(
            runtime,
            status=RuntimeStatus.RUNNING,
            manager=self.name,
            dashboard_url=_tenant_dashboard_url(str(holder["dashboard_url"]), runtime),
            dashboard_token=dashboard_token,
            last_started_at=now_iso(),
            last_seen_at=now_iso(),
            last_error=None,
            external_ref=str(holder["worker"]),
        )

    async def stop(self, runtime: RuntimeInstance) -> RuntimeInstance:
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder:
            # Ask the holder to sync + detach; it releases the lease itself.
            publish(
                worker_control_channel(str(holder["worker"])),
                {"op": "detach", "workspace_id": runtime.workspace_id, "agent_id": runtime.agent_id},
            )
        else:
            # Orphaned lease (worker died): clear it so the next start re-attaches.
            stale = await asyncio.to_thread(
                lookup_holder, tenant_lease_key(runtime.workspace_id, runtime.agent_id)
            )
            if stale:
                await asyncio.to_thread(
                    release_lease, tenant_lease_key(runtime.workspace_id, runtime.agent_id), str(stale)
                )
        return save_runtime(runtime, status=RuntimeStatus.STOPPED, last_error=None, external_ref=None)

    async def restart(
        self,
        runtime: RuntimeInstance,
        *,
        extra_env: dict[str, str] | None = None,
    ) -> RuntimeInstance:
        await self.stop(runtime)
        return await self.start(runtime, extra_env=extra_env)

    async def drain(self, runtime: RuntimeInstance) -> RuntimeInstance:
        return await self.stop(runtime)

    # -------------------------------------------------------------- routing
    async def address(self, runtime: RuntimeInstance) -> str | None:
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder is None:
            return None
        return _tenant_dashboard_url(str(holder["dashboard_url"]), runtime)

    async def webhook_address(self, runtime: RuntimeInstance) -> str | None:
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder is None or not holder.get("webhook_url"):
            return None
        return urljoin(str(holder["webhook_url"]).rstrip("/") + "/", f"p/{tenant_key(runtime)}/")

    async def api_server_address(self, runtime: RuntimeInstance) -> str | None:
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder is None or not holder.get("api_url"):
            return None
        return str(holder["api_url"])

    async def health(self, runtime: RuntimeInstance) -> tuple[bool, str]:
        holder = await asyncio.to_thread(self.holder, runtime)
        if holder:
            return True, f"Tenant attached to worker {holder['worker']}"
        if runtime.status in {RuntimeStatus.RUNNING, RuntimeStatus.STARTING, "running", "starting"}:
            return False, "Tenant is not attached to any live worker."
        return False, "Tenant is stopped."

    def supports_publish_ports(self) -> bool:
        return False
