"""High-level lifecycle: wake, touch activity, idle reaper (Phase 1 + 5)."""

from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from app import db
from app.control_plane import runtime_from_row, save_runtime
from app.models import RuntimeInstance
from app.runtime_orch.checkpoints import checkpoint_hermes_home, restore_hermes_home
from app.runtime_orch.factory import get_runtime_manager
from app.runtime_orch.idle import idle_enabled, resolve_idle_policy
from app.runtime_orch.leases import get_lease_store
from app.runtime_orch.states import RuntimeStatus, is_warm
from app.runtime_orch.wake_queue import WakeJob, get_wake_queue

logger = logging.getLogger(__name__)


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        raw = value.replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except ValueError:
        return None


def touch_runtime_activity(runtime: RuntimeInstance) -> RuntimeInstance:
    from app.control_plane import now_iso

    return save_runtime(runtime, last_seen_at=now_iso(), last_activity_at=now_iso())


def remember_runtime_healthy(runtime: RuntimeInstance) -> RuntimeInstance:
    """Promote a reachable runtime out of 'starting' so boot stops stampeding it."""
    from app.control_plane import now_iso
    from app.runtime_manager import mark_runtime_healthy
    from app.runtime_orch.states import RuntimeStatus, normalize_status

    mark_runtime_healthy(runtime)
    fields: dict[str, Any] = {
        "last_seen_at": now_iso(),
        "last_activity_at": now_iso(),
        "last_error": None,
    }
    if normalize_status(runtime.status) != RuntimeStatus.RUNNING:
        fields["status"] = RuntimeStatus.RUNNING
    return save_runtime(runtime, **fields)


async def wake_runtime(
    runtime: RuntimeInstance,
    *,
    extra_env: dict[str, str] | None = None,
    wait_ready: bool = True,
    reason: str = "api",
) -> RuntimeInstance:
    """Idempotent wake: acquire lease, restore snapshot if needed, start, touch activity."""
    manager = get_runtime_manager()
    store = get_lease_store()
    lease = store.try_acquire(f"runtime-start:{runtime.id}", ttl_seconds=120)
    if lease is None:
        # Another worker is starting this runtime. If the caller needs ready,
        # poll health instead of returning a stale "starting" row immediately.
        if wait_ready:
            deadline = time.monotonic() + float(os.getenv("VERXIO_RUNTIME_READY_TIMEOUT_SECONDS", "180") or "180")
            while time.monotonic() < deadline:
                row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
                current = runtime_from_row(row or runtime.model_dump())
                if is_warm(current.status):
                    ok, _ = await manager.health(current)
                    if ok:
                        return remember_runtime_healthy(current)
                await asyncio.sleep(2.0)
        row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
        return runtime_from_row(row or runtime.model_dump())

    try:
        current = runtime
        if is_warm(current.status):
            ok, _ = await manager.health(current)
            if ok:
                return remember_runtime_healthy(current)

        # Ephemeral backends / wiped nodes: restore hermes-home before start.
        restored = restore_hermes_home(current, only_if_missing=True)
        if restored:
            logger.info("Restored hermes-home snapshot for runtime %s", current.id)

        logger.info("Waking runtime %s reason=%s manager=%s", runtime.id, reason, manager.name)
        started = await manager.start(current, extra_env=extra_env, wait_ready=wait_ready)
        return touch_runtime_activity(started)
    finally:
        store.release(lease)


async def drain_runtime(runtime: RuntimeInstance) -> RuntimeInstance:
    manager = get_runtime_manager()
    # Always checkpoint at the lifecycle layer so every backend gets a snapshot.
    checkpoint_hermes_home(runtime)
    return await manager.drain(runtime)


def list_idle_candidates(*, now: datetime | None = None) -> list[RuntimeInstance]:
    if not idle_enabled():
        return []
    now = now or datetime.now(timezone.utc)
    rows = db.fetch_all(
        """
        SELECT * FROM runtime_instances
        WHERE status IN ('running', 'starting')
        """
    )
    candidates: list[RuntimeInstance] = []
    for row in rows:
        runtime = runtime_from_row(row)
        policy = resolve_idle_policy(row.get("idle_policy") if isinstance(row, dict) else None)
        if policy.idle_ttl_seconds <= 0:
            continue
        anchor = (
            _parse_iso(runtime.last_activity_at)
            or _parse_iso(runtime.last_seen_at)
            or _parse_iso(runtime.last_started_at)
        )
        if anchor is None:
            continue
        if now - anchor >= timedelta(seconds=policy.idle_ttl_seconds):
            candidates.append(runtime)
    return candidates


async def reap_idle_runtimes(*, limit: int = 50) -> list[str]:
    drained: list[str] = []
    for runtime in list_idle_candidates()[:limit]:
        try:
            await drain_runtime(runtime)
            drained.append(runtime.id)
        except Exception:
            logger.exception("Failed to drain idle runtime %s", runtime.id)
    return drained


async def enqueue_wake(runtime: RuntimeInstance, *, reason: str) -> bool:
    queue = get_wake_queue()
    return await queue.enqueue(
        WakeJob(runtime_id=runtime.id, tenant_id=runtime.tenant_id, reason=reason)
    )
