"""Spin-up phase for a tenant runtime, shared between workers and the API.

The pool has no container to inspect while a tenant is "starting": the API
only sees ``status=starting`` until a worker takes the lease. Workers publish
the step they are on so ``GET /api/runtime`` can tell the UI what is happening
(queued -> restoring home -> attaching profile -> ready) instead of a blank
"Starting…" for up to a minute on a cold home restore.
"""

from __future__ import annotations

import json
import time
from typing import Any, Final

from app.infra.redis import cache_delete, cache_get, cache_set

PHASE_QUEUED: Final = "queued"
PHASE_RESTORING_HOME: Final = "restoring_home"
PHASE_PREPARING_ENV: Final = "preparing_env"
PHASE_ATTACHING_PROFILE: Final = "attaching_profile"
PHASE_READY: Final = "ready"
PHASE_FAILED: Final = "failed"
PHASE_STARTING: Final = "starting"  # legacy container planes: no finer detail
PHASE_STOPPED: Final = "stopped"

# Order used by the UI to render a progress bar; anything unknown maps to "starting".
PHASE_ORDER: Final = (
    PHASE_QUEUED,
    PHASE_RESTORING_HOME,
    PHASE_PREPARING_ENV,
    PHASE_ATTACHING_PROFILE,
    PHASE_READY,
)

_TTL_SECONDS = 15 * 60


def _key(workspace_id: str, agent_id: str) -> str:
    return f"phase:{workspace_id}:{agent_id}"


def set_phase(workspace_id: str, agent_id: str, phase: str, *, detail: str | None = None) -> None:
    payload: dict[str, Any] = {"phase": phase, "at": time.time()}
    if detail:
        payload["detail"] = detail
    cache_set(_key(workspace_id, agent_id), json.dumps(payload), ttl_seconds=_TTL_SECONDS)


def clear_phase(workspace_id: str, agent_id: str) -> None:
    cache_delete(_key(workspace_id, agent_id))


def get_phase(workspace_id: str, agent_id: str) -> dict[str, Any] | None:
    raw = cache_get(_key(workspace_id, agent_id))
    if not raw:
        return None
    try:
        data = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return data if isinstance(data, dict) and data.get("phase") else None


def phase_for_status(
    workspace_id: str,
    agent_id: str,
    *,
    status: str,
    connected: bool,
    pool: bool,
) -> tuple[str, str | None]:
    """Resolve the phase the UI should show for a runtime status probe."""
    if connected:
        return PHASE_READY, None
    if status not in {"running", "starting"}:
        return PHASE_STOPPED, None
    if not pool:
        return PHASE_STARTING, None
    recorded = get_phase(workspace_id, agent_id)
    if recorded:
        phase = str(recorded["phase"])
        # A worker reported ready but the API probe disagrees (lease lost):
        # show the retry rather than a stale "ready".
        if phase == PHASE_READY:
            return PHASE_QUEUED, "Re-attaching to an agent worker."
        return phase, (str(recorded["detail"]) if recorded.get("detail") else None)
    return PHASE_QUEUED, None
