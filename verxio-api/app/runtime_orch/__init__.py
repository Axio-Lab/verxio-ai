"""Pluggable runtime orchestration for Verxio scale architecture.

Backends:
  - LocalDockerRuntimeManager (legacy / ECS fallback)
  - K8sRuntimeManager (local kind + production cluster)
"""

from app.runtime_orch.factory import get_runtime_manager
from app.runtime_orch.states import RuntimeStatus, assert_transition, normalize_status

__all__ = [
    "RuntimeStatus",
    "assert_transition",
    "get_runtime_manager",
    "normalize_status",
]
