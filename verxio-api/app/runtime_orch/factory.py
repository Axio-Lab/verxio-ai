"""Factory for RuntimeManager backends.

``get_runtime_manager()`` returns the process-default backend
(``VERXIO_RUNTIME_MANAGER``). ``get_runtime_manager(runtime)`` honours the
per-tenant plane flag (``runtime_plane_flags``, see :mod:`app.plane`) so the
pool and the legacy per-user planes can run side by side during cutover.
Managers are memoised per backend name; a runtime whose row already records
``manager`` keeps using that backend until it is stopped and re-flagged.
"""

from __future__ import annotations

import os
from typing import TYPE_CHECKING

from app.runtime_orch.manager import RuntimeManager

if TYPE_CHECKING:  # pragma: no cover
    from app.runtime import RuntimeInstance


_MANAGERS: dict[str, RuntimeManager] = {}

_NAMES = {
    "pool": "pool",
    "worker-pool": "pool",
    "workers": "pool",
    "local-docker": "local-docker",
    "docker": "local-docker",
    "local": "local-docker",
    "k8s": "k8s",
    "kubernetes": "k8s",
}


def normalize_manager_name(name: str | None) -> str:
    key = (name or "").strip().lower()
    if key not in _NAMES:
        raise ValueError(f"Unknown VERXIO_RUNTIME_MANAGER={key!r} (expected pool|local-docker|k8s)")
    return _NAMES[key]


def configured_manager_name() -> str:
    return (os.getenv("VERXIO_RUNTIME_MANAGER", "pool") or "pool").strip().lower()


class LegacyPlaneDisabled(RuntimeError):
    """A docker/k8s manager was requested after the legacy plane was switched off."""


def legacy_planes_enabled() -> bool:
    """Cutover switch. ``VERXIO_LEGACY_PLANES=0`` makes any attempt to build a
    per-user docker/k8s manager fail fast, so operators can prove nothing still
    depends on them before the modules (and docker.sock) are deleted."""
    return os.getenv("VERXIO_LEGACY_PLANES", "0").strip().lower() not in {"0", "false", "no", "off"}


def build_runtime_manager(name: str | None = None) -> RuntimeManager:
    key = normalize_manager_name(name or configured_manager_name())
    if key != "pool":
        raise LegacyPlaneDisabled(
            f"runtime manager {key!r} was removed; the cloud agent runs on the pool plane only"
        )
    from app.runtime_orch.pool import PoolRuntimeManager

    return PoolRuntimeManager()


def manager_by_name(name: str | None) -> RuntimeManager:
    key = normalize_manager_name(name or configured_manager_name())
    manager = _MANAGERS.get(key)
    if manager is None:
        manager = build_runtime_manager(key)
        _MANAGERS[key] = manager
    return manager


def manager_name_for_runtime(runtime: "RuntimeInstance") -> str:
    """Backend for a tenant: the recorded ``runtime.manager`` while it is live,
    else the tenant's plane flag, else the process default."""
    recorded = (getattr(runtime, "manager", None) or "").strip().lower()
    status = str(getattr(runtime, "status", "") or "").strip().lower()
    # A live runtime stays on the backend that started it; once it is stopped
    # (or errored) the plane flag decides where it comes back up.
    if recorded and status in {"running", "starting", "draining"}:
        try:
            name = normalize_manager_name(recorded)
        except ValueError:
            name = "pool"
        # Docker and Kubernetes managers are gone. A leftover row comes back on the pool.
        return name if name == "pool" else "pool"
    from app.plane import manager_name_for_plane, resolve_plane

    return manager_name_for_plane(resolve_plane(runtime.workspace_id, runtime.agent_id))


def get_runtime_manager(runtime: "RuntimeInstance | None" = None) -> RuntimeManager:
    if runtime is None:
        return manager_by_name(None)
    return manager_by_name(manager_name_for_runtime(runtime))


def reset_runtime_manager_for_tests() -> None:
    _MANAGERS.clear()
