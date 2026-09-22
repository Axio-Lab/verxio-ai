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
    return (os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()


def build_runtime_manager(name: str | None = None) -> RuntimeManager:
    key = normalize_manager_name(name or configured_manager_name())
    if key == "pool":
        from app.runtime_orch.pool import PoolRuntimeManager

        return PoolRuntimeManager()
    if key == "local-docker":
        from app.runtime_orch.local_docker import LocalDockerRuntimeManager

        return LocalDockerRuntimeManager()
    from app.runtime_orch.k8s import K8sRuntimeManager

    return K8sRuntimeManager()


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
            return normalize_manager_name(recorded)
        except ValueError:
            pass
    from app.plane import manager_name_for_plane, resolve_plane

    return manager_name_for_plane(resolve_plane(runtime.workspace_id, runtime.agent_id))


def get_runtime_manager(runtime: "RuntimeInstance | None" = None) -> RuntimeManager:
    if runtime is None:
        return manager_by_name(None)
    return manager_by_name(manager_name_for_runtime(runtime))


def reset_runtime_manager_for_tests() -> None:
    _MANAGERS.clear()
