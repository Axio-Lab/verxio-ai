"""Control-plane dashboard watchdog.

Every running runtime is probed on ``/api/healthz`` directly (no
recently-healthy cache) and consecutive failures are tracked in memory.
Escalation, per runtime:

    failures >= N        → restart the s6 ``dashboard`` service (SIGTERM)
    failures >= 2N       → SIGKILL the dashboard service
    failures >= 3N       → full manager restart (pod / container)

The in-image ``dashboard-watchdog`` s6 service normally fixes a wedge
first; this loop is the second line for planes without it (older images)
and for pods whose watchdog itself cannot act. It never touches a runtime
whose compute is gone — that is ``reconcile_missing_runtimes``' job.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from dataclasses import dataclass, field

import httpx

from app import db
from app.control_plane import runtime_from_row
from app.metrics import HEALTH_PROBES, WATCHDOG_ACTIONS
from app.models import RuntimeInstance
from app.runtime_orch.factory import get_runtime_manager

logger = logging.getLogger(__name__)


@dataclass
class _Track:
    failures: int = 0
    first_failure_at: float = 0.0
    last_action_at: float = 0.0
    actions: list[str] = field(default_factory=list)


_TRACKS: dict[str, _Track] = {}


def _env_int(name: str, default: int) -> int:
    raw = (os.getenv(name) or "").strip()
    try:
        return max(1, int(raw)) if raw else default
    except ValueError:
        return default


def failure_threshold() -> int:
    return _env_int("VERXIO_RUNTIME_WATCHDOG_FAILURES", 4)


def probe_timeout_seconds() -> float:
    raw = (os.getenv("VERXIO_RUNTIME_WATCHDOG_TIMEOUT_SECONDS") or "").strip()
    try:
        return max(1.0, float(raw)) if raw else 5.0
    except ValueError:
        return 5.0


def reset_for_tests() -> None:
    _TRACKS.clear()


def tracked_failures(runtime_id: str) -> int:
    track = _TRACKS.get(runtime_id)
    return track.failures if track else 0


async def probe_healthz(runtime: RuntimeInstance) -> bool:
    """Direct, uncached healthz probe against the runtime's internal URL."""
    from app.runtime_manager import runtime_dashboard_base_url

    base = runtime_dashboard_base_url(runtime, ensure_network=False) or runtime.dashboard_url
    if not base:
        return False
    try:
        async with httpx.AsyncClient(timeout=probe_timeout_seconds()) as client:
            response = await client.get(f"{base.rstrip('/')}/api/healthz")
            ok = response.status_code == 200
    except Exception:
        ok = False
    HEALTH_PROBES.inc(result="ok" if ok else "fail")
    return ok


async def _heal(runtime: RuntimeInstance, track: _Track) -> str | None:
    """Pick and run the escalation step for this failure count."""
    manager = get_runtime_manager(runtime)
    threshold = failure_threshold()
    if track.failures < threshold:
        return None
    restart_dashboard = getattr(manager, "restart_dashboard", None)

    # Managers without a service-level restart (pool sidecars are healed by
    # their worker) go straight to a compute restart at the top rung only.
    if restart_dashboard is None:
        if track.failures < 3 * threshold:
            return None
    elif track.failures < 2 * threshold:
        return "restart-dashboard" if await restart_dashboard(runtime, force=False) else None
    elif track.failures < 3 * threshold:
        return "restart-dashboard-kill" if await restart_dashboard(runtime, force=True) else None

    logger.error(
        "Runtime %s dashboard unhealthy for %d probes; restarting compute via %s",
        runtime.id,
        track.failures,
        manager.name,
    )
    await manager.restart(runtime)
    track.failures = 0
    return "restart-compute"


async def heal_unhealthy_runtimes(*, limit: int = 200) -> dict[str, list[str]]:
    """One watchdog tick. Returns ``{"unhealthy": [...], "healed": [...]}``."""
    rows = db.fetch_all(
        """
        SELECT * FROM runtime_instances
        WHERE status = 'running'
        ORDER BY updated_at DESC
        LIMIT ?
        """,
        (limit,),
    )
    runtimes = [runtime_from_row(row) for row in rows]
    live_ids = {rt.id for rt in runtimes}
    for stale in [rid for rid in _TRACKS if rid not in live_ids]:
        _TRACKS.pop(stale, None)

    results = await asyncio.gather(*(probe_healthz(rt) for rt in runtimes), return_exceptions=True)
    unhealthy: list[str] = []
    healed: list[str] = []
    now = time.monotonic()
    for runtime, ok in zip(runtimes, results, strict=True):
        if ok is True:
            if runtime.id in _TRACKS and _TRACKS[runtime.id].failures:
                logger.info("Runtime %s dashboard healthy again", runtime.id)
            _TRACKS.pop(runtime.id, None)
            continue
        track = _TRACKS.setdefault(runtime.id, _Track())
        if track.failures == 0:
            track.first_failure_at = now
        track.failures += 1
        unhealthy.append(runtime.id)
        # Only one action per threshold window so SIGTERM has time to work.
        if track.failures % failure_threshold() != 0:
            continue
        try:
            action = await _heal(runtime, track)
        except Exception:
            logger.exception("Watchdog heal failed for runtime %s", runtime.id)
            continue
        if action:
            track.last_action_at = now
            track.actions.append(action)
            healed.append(f"{runtime.id}:{action}")
            WATCHDOG_ACTIONS.inc(action=action)
            logger.warning(
                "Watchdog action %s on runtime %s after %d failed probes (%.0fs)",
                action,
                runtime.id,
                track.failures,
                now - track.first_failure_at,
            )
    return {"unhealthy": unhealthy, "healed": healed}
