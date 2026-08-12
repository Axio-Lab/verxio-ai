"""Runtime lifecycle states for scale-to-zero orchestration."""

from __future__ import annotations

from enum import StrEnum


class RuntimeStatus(StrEnum):
    STOPPED = "stopped"
    STARTING = "starting"
    RUNNING = "running"
    DRAINING = "draining"
    ERROR = "error"


# Allowed transitions for the control plane state machine.
ALLOWED_TRANSITIONS: dict[RuntimeStatus, frozenset[RuntimeStatus]] = {
    RuntimeStatus.STOPPED: frozenset({RuntimeStatus.STARTING, RuntimeStatus.ERROR}),
    RuntimeStatus.STARTING: frozenset(
        {RuntimeStatus.RUNNING, RuntimeStatus.ERROR, RuntimeStatus.STOPPED, RuntimeStatus.DRAINING}
    ),
    RuntimeStatus.RUNNING: frozenset(
        {RuntimeStatus.DRAINING, RuntimeStatus.STOPPED, RuntimeStatus.ERROR, RuntimeStatus.STARTING}
    ),
    RuntimeStatus.DRAINING: frozenset(
        {RuntimeStatus.STOPPED, RuntimeStatus.ERROR, RuntimeStatus.RUNNING, RuntimeStatus.STARTING}
    ),
    RuntimeStatus.ERROR: frozenset(
        {RuntimeStatus.STOPPED, RuntimeStatus.STARTING, RuntimeStatus.RUNNING, RuntimeStatus.DRAINING}
    ),
}


def normalize_status(value: str | None) -> RuntimeStatus:
    raw = (value or RuntimeStatus.STOPPED).strip().lower()
    try:
        return RuntimeStatus(raw)
    except ValueError:
        return RuntimeStatus.ERROR


def assert_transition(current: str | RuntimeStatus, nxt: str | RuntimeStatus) -> RuntimeStatus:
    """Return the next status, raising ValueError if the transition is illegal."""
    cur = normalize_status(str(current))
    nxt_status = normalize_status(str(nxt))
    if cur == nxt_status:
        return nxt_status
    allowed = ALLOWED_TRANSITIONS.get(cur, frozenset())
    if nxt_status not in allowed:
        raise ValueError(f"Illegal runtime transition: {cur} -> {nxt_status}")
    return nxt_status


def is_warm(status: str | RuntimeStatus) -> bool:
    return normalize_status(status) in {RuntimeStatus.STARTING, RuntimeStatus.RUNNING, RuntimeStatus.DRAINING}
