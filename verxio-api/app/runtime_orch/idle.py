"""Plan-based idle / warm policies (Phase 1 + 5)."""

from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class IdlePolicy:
    name: str
    idle_ttl_seconds: int
    warm_hold_seconds: int
    cold_start_slo_seconds: int


_POLICIES: dict[str, IdlePolicy] = {
    "default": IdlePolicy("default", idle_ttl_seconds=1800, warm_hold_seconds=0, cold_start_slo_seconds=90),
    "free": IdlePolicy("free", idle_ttl_seconds=900, warm_hold_seconds=0, cold_start_slo_seconds=60),
    "pro": IdlePolicy("pro", idle_ttl_seconds=3600, warm_hold_seconds=300, cold_start_slo_seconds=15),
    "business": IdlePolicy("business", idle_ttl_seconds=7200, warm_hold_seconds=1800, cold_start_slo_seconds=10),
    "always_on": IdlePolicy("always_on", idle_ttl_seconds=0, warm_hold_seconds=0, cold_start_slo_seconds=5),
}


def idle_enabled() -> bool:
    return os.getenv("VERXIO_RUNTIME_IDLE_ENABLED", "true").strip().lower() in {"1", "true", "yes", "on"}


def resolve_idle_policy(name: str | None = None) -> IdlePolicy:
    key = (name or os.getenv("VERXIO_RUNTIME_IDLE_POLICY", "default") or "default").strip().lower()
    return _POLICIES.get(key, _POLICIES["default"])


def list_idle_policies() -> list[IdlePolicy]:
    return list(_POLICIES.values())
