"""Factory for RuntimeManager backends."""

from __future__ import annotations

import os

from app.runtime_orch.k8s import K8sRuntimeManager
from app.runtime_orch.local_docker import LocalDockerRuntimeManager
from app.runtime_orch.manager import RuntimeManager


_MANAGER: RuntimeManager | None = None


def configured_manager_name() -> str:
    return (os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()


def build_runtime_manager(name: str | None = None) -> RuntimeManager:
    key = (name or configured_manager_name()).strip().lower()
    if key in {"local-docker", "docker", "local"}:
        return LocalDockerRuntimeManager()
    if key in {"k8s", "kubernetes"}:
        return K8sRuntimeManager()
    raise ValueError(f"Unknown VERXIO_RUNTIME_MANAGER={key!r} (expected local-docker|k8s)")


def get_runtime_manager() -> RuntimeManager:
    global _MANAGER
    if _MANAGER is None:
        _MANAGER = build_runtime_manager()
    return _MANAGER


def reset_runtime_manager_for_tests() -> None:
    global _MANAGER
    _MANAGER = None
