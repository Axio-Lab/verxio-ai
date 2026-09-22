"""Tenants attached to this worker: leases, home lifecycle, idle detach.

A tenant is "attached" when this worker holds ``tenant:{ws}:{agent}`` (token =
worker id), its hermes-home/workspace are on local disk, and the Hermes
sidecar knows the profile. While attached we heartbeat the lease, sync the
home to object storage after activity, and detach after an idle period so the
worker's capacity is reclaimed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field
from pathlib import Path

from app import db
from app.control_plane import runtime_from_row
from app.homes import (
    local_home_path,
    local_workspace_path,
    restore_home,
    sync_home,
    write_home_env,
)
from app.infra.redis import (
    heartbeat_lease,
    lookup_holder,
    publish,
    register_worker,
    release_lease,
    tenant_lease_key,
    try_acquire_lease,
    unregister_worker,
    worker_id,
)
from app.models import RuntimeInstance
from app.runtime_phase import (
    PHASE_ATTACHING_PROFILE,
    PHASE_FAILED,
    PHASE_PREPARING_ENV,
    PHASE_READY,
    PHASE_RESTORING_HOME,
    clear_phase,
    set_phase,
)
from app.tenant_env import load_tenant_env, tenant_env_updated_at
from app.worker import hermes_client

logger = logging.getLogger("verxio.worker.tenants")

LEASE_TTL_SECONDS = 90.0


def tenant_name(workspace_id: str, agent_id: str) -> str:
    return f"{workspace_id}:{agent_id}"


def _float_env(name: str, default: float, minimum: float) -> float:
    raw = os.getenv(name, "").strip()
    try:
        return max(minimum, float(raw)) if raw else default
    except ValueError:
        return default


def max_tenants() -> int:
    raw = os.getenv("VERXIO_WORKER_MAX_TENANTS", "40").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 40


def idle_seconds() -> float:
    return _float_env("VERXIO_TENANT_IDLE_SECONDS", 1800.0, 60.0)


def sync_interval_seconds() -> float:
    return _float_env("VERXIO_HOME_SYNC_INTERVAL_SECONDS", 120.0, 10.0)


def advertise_urls() -> dict[str, str]:
    dashboard = os.getenv("VERXIO_WORKER_ADVERTISE_URL", "").strip()
    if not dashboard:
        host = os.getenv("VERXIO_WORKER_ADVERTISE_HOST", "").strip() or os.uname().nodename
        dashboard = f"http://{host}:{os.getenv('VERXIO_WORKER_ADVERTISE_PORT', '9119').strip() or '9119'}"
    api = os.getenv("VERXIO_WORKER_ADVERTISE_API_URL", "").strip()
    if not api:
        api = dashboard.rsplit(":", 1)[0] + ":8642" if dashboard.count(":") >= 2 else dashboard
    return {"dashboard_url": dashboard.rstrip("/"), "api_url": api.rstrip("/")}


class AttachRejected(RuntimeError):
    """Another live worker holds the tenant, or we are at capacity."""

    def __init__(self, message: str, holder: str | None = None) -> None:
        super().__init__(message)
        self.holder = holder


@dataclass
class AttachedTenant:
    runtime: RuntimeInstance
    attached_at: float = field(default_factory=time.monotonic)
    last_activity: float = field(default_factory=time.monotonic)
    last_synced: float = 0.0
    dirty: bool = False
    env_version: str | None = None
    active_runs: int = 0
    lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    @property
    def name(self) -> str:
        return tenant_name(self.runtime.workspace_id, self.runtime.agent_id)

    @property
    def lease_key(self) -> str:
        return tenant_lease_key(self.runtime.workspace_id, self.runtime.agent_id)

    @property
    def home(self) -> Path:
        return local_home_path(self.runtime)


class TenantRegistry:
    def __init__(self) -> None:
        self._tenants: dict[str, AttachedTenant] = {}
        self._attach_locks: dict[str, asyncio.Lock] = {}
        self.worker = worker_id()

    # ----------------------------------------------------------------- state
    def get(self, workspace_id: str, agent_id: str) -> AttachedTenant | None:
        return self._tenants.get(tenant_name(workspace_id, agent_id))

    def all(self) -> list[AttachedTenant]:
        return list(self._tenants.values())

    def _attach_lock(self, name: str) -> asyncio.Lock:
        lock = self._attach_locks.get(name)
        if lock is None:
            lock = self._attach_locks[name] = asyncio.Lock()
        return lock

    def register(self) -> None:
        register_worker(
            self.worker,
            {**advertise_urls(), "tenants": len(self._tenants), "capacity": max_tenants()},
            ttl_seconds=45.0,
        )

    # ---------------------------------------------------------------- attach
    async def ensure_attached(self, workspace_id: str, agent_id: str) -> AttachedTenant:
        """Attach (or reuse) a tenant. Raises ``AttachRejected`` when another worker holds it."""
        name = tenant_name(workspace_id, agent_id)
        async with self._attach_lock(name):
            current = self._tenants.get(name)
            if current is not None:
                if await asyncio.to_thread(heartbeat_lease, current.lease_key, self.worker, ttl_seconds=LEASE_TTL_SECONDS):
                    await self._refresh_env_if_changed(current)
                    return current
                # Lease slipped away (worker paused too long): fall through and re-acquire.
                self._tenants.pop(name, None)

            row = await asyncio.to_thread(
                db.fetch_one,
                "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
                (workspace_id, agent_id),
            )
            if not row:
                raise AttachRejected(f"No runtime instance for tenant {name}")
            runtime = runtime_from_row(row)

            lease_key = tenant_lease_key(workspace_id, agent_id)
            token = await asyncio.to_thread(try_acquire_lease, lease_key, ttl_seconds=LEASE_TTL_SECONDS, token=self.worker)
            if token is None:
                holder = await asyncio.to_thread(lookup_holder, lease_key)
                if holder != self.worker:
                    raise AttachRejected(f"Tenant {name} is leased by {holder}", holder=holder)
            if len(self._tenants) >= max_tenants():
                await asyncio.to_thread(release_lease, lease_key, self.worker)
                raise AttachRejected(f"Worker {self.worker} at capacity ({max_tenants()})")

            tenant = AttachedTenant(runtime=runtime)
            try:
                await asyncio.to_thread(set_phase, workspace_id, agent_id, PHASE_RESTORING_HOME)
                await asyncio.to_thread(restore_home, runtime, only_if_missing=True)
                await asyncio.to_thread(set_phase, workspace_id, agent_id, PHASE_PREPARING_ENV)
                await self._materialize_env(tenant)
                local_workspace_path(runtime).mkdir(parents=True, exist_ok=True)
                await asyncio.to_thread(set_phase, workspace_id, agent_id, PHASE_ATTACHING_PROFILE)
                await hermes_client.attach_profile(name, str(local_home_path(runtime)))
            except Exception as exc:
                await asyncio.to_thread(
                    set_phase, workspace_id, agent_id, PHASE_FAILED, detail=str(exc)[:200] or exc.__class__.__name__
                )
                await asyncio.to_thread(release_lease, lease_key, self.worker)
                raise
            await asyncio.to_thread(set_phase, workspace_id, agent_id, PHASE_READY)
            self._tenants[name] = tenant
            self.register()
            publish(
                f"verxio:attach:{workspace_id}:{agent_id}",
                {"status": "attached", "worker": self.worker, **advertise_urls()},
            )
            logger.info("Attached tenant %s (%d/%d)", name, len(self._tenants), max_tenants())
            return tenant

    async def _materialize_env(self, tenant: AttachedTenant) -> None:
        runtime = tenant.runtime
        env = await asyncio.to_thread(load_tenant_env, runtime.workspace_id, runtime.agent_id)
        env.setdefault("VERXIO_WORKSPACE_ID", runtime.workspace_id)
        env.setdefault("VERXIO_AGENT_ID", runtime.agent_id)
        env.setdefault("VERXIO_HOSTED", "1")
        env.setdefault("TERMINAL_CWD", str(local_workspace_path(runtime)))
        # Read by Hermes' hosted sandbox (tools/environments/verxio_sandbox.py)
        # through the tenant secret scope; TERMINAL_* is process-global there.
        env.setdefault("VERXIO_WORKSPACE_DIR", str(local_workspace_path(runtime)))
        env.setdefault("HERMES_MEDIA_ALLOW_DIRS", str(local_workspace_path(runtime)))
        await asyncio.to_thread(write_home_env, local_home_path(runtime), env)
        tenant.env_version = await asyncio.to_thread(tenant_env_updated_at, runtime.workspace_id, runtime.agent_id)

    async def _refresh_env_if_changed(self, tenant: AttachedTenant) -> None:
        version = await asyncio.to_thread(
            tenant_env_updated_at, tenant.runtime.workspace_id, tenant.runtime.agent_id
        )
        if version and version != tenant.env_version:
            await self._materialize_env(tenant)

    # ---------------------------------------------------------------- detach
    async def detach(self, name: str, *, reason: str) -> None:
        tenant = self._tenants.pop(name, None)
        if tenant is None:
            return
        try:
            if tenant.dirty or tenant.last_synced == 0.0:
                await asyncio.to_thread(sync_home, tenant.runtime)
        except Exception:
            logger.exception("Final home sync failed tenant=%s", name)
        try:
            await hermes_client.detach_profile(name)
        except Exception:
            logger.warning("Hermes detach failed tenant=%s", name, exc_info=True)
        await asyncio.to_thread(release_lease, tenant.lease_key, self.worker)
        await asyncio.to_thread(clear_phase, tenant.runtime.workspace_id, tenant.runtime.agent_id)
        self.register()
        publish(
            f"verxio:attach:{tenant.runtime.workspace_id}:{tenant.runtime.agent_id}",
            {"status": "detached", "worker": self.worker, "reason": reason},
        )
        logger.info("Detached tenant %s reason=%s", name, reason)

    async def detach_all(self, *, reason: str) -> None:
        for name in list(self._tenants):
            await self.detach(name, reason=reason)
        unregister_worker(self.worker)

    # -------------------------------------------------------------- activity
    def mark_activity(self, tenant: AttachedTenant) -> None:
        tenant.last_activity = time.monotonic()
        tenant.dirty = True

    async def sync_if_due(self, tenant: AttachedTenant, *, force: bool = False) -> bool:
        if tenant.active_runs > 0 and not force:
            return False
        if not tenant.dirty and not force:
            return False
        if not force and time.monotonic() - tenant.last_synced < sync_interval_seconds():
            return False
        async with tenant.lock:
            await asyncio.to_thread(sync_home, tenant.runtime)
            tenant.last_synced = time.monotonic()
            tenant.dirty = False
        return True

    # ------------------------------------------------------------ background
    async def control_loop(self, stop: asyncio.Event) -> None:
        """Serve API nudges: forced detach (stop/drain) and env refresh."""
        from app.infra.redis import subscribe, worker_control_channel

        async for message in subscribe(worker_control_channel(self.worker)):
            if stop.is_set():
                return
            op = str(message.get("op") or "")
            name = tenant_name(str(message.get("workspace_id") or ""), str(message.get("agent_id") or ""))
            tenant = self._tenants.get(name)
            try:
                if op == "detach" and tenant is not None:
                    if tenant.active_runs:
                        # Let in-flight runs finish; the idle reaper will not
                        # touch a tenant with active runs, so poll briefly.
                        for _ in range(120):
                            await asyncio.sleep(1.0)
                            if not tenant.active_runs:
                                break
                    await self.detach(name, reason="api_stop")
                elif op == "env_updated" and tenant is not None:
                    await self._materialize_env(tenant)
            except Exception:
                logger.exception("Control op failed op=%s tenant=%s", op, name)

    async def maintenance_loop(self, stop: asyncio.Event) -> None:
        """Heartbeat leases, advertise the worker, sync dirty homes, reap idle tenants."""
        interval = 15.0
        while not stop.is_set():
            try:
                self.register()
                now = time.monotonic()
                for tenant in self.all():
                    ok = await asyncio.to_thread(
                        heartbeat_lease, tenant.lease_key, self.worker, ttl_seconds=LEASE_TTL_SECONDS
                    )
                    if not ok and tenant.active_runs == 0:
                        # Someone else owns it now; drop our copy without touching the lease.
                        logger.warning("Lost lease for %s; dropping local attachment", tenant.name)
                        self._tenants.pop(tenant.name, None)
                        try:
                            await hermes_client.detach_profile(tenant.name)
                        except Exception:
                            pass
                        continue
                    if tenant.active_runs == 0 and now - tenant.last_activity > idle_seconds():
                        await self.detach(tenant.name, reason="idle")
                        continue
                    try:
                        await self.sync_if_due(tenant)
                    except Exception:
                        logger.exception("Home sync failed tenant=%s", tenant.name)
            except Exception:
                logger.exception("Tenant maintenance tick failed")
            try:
                await asyncio.wait_for(stop.wait(), timeout=interval)
            except asyncio.TimeoutError:
                continue


def workspace_dir(tenant: AttachedTenant) -> Path:
    return local_workspace_path(tenant.runtime)
