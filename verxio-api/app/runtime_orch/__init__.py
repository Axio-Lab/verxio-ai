"""Pluggable runtime orchestration for Verxio scale architecture.

Phases:
  1. Lifecycle state machine + idle/wake
  2. RuntimeManager protocol + LocalDocker
  3. Redis leases + artifact object store
  4. FlyRuntimeManager
  5. Plan idle policies + wake queue
  6. K8sRuntimeManager stub
"""

from app.runtime_orch.factory import get_runtime_manager
from app.runtime_orch.states import RuntimeStatus, assert_transition, normalize_status

__all__ = [
    "RuntimeStatus",
    "assert_transition",
    "get_runtime_manager",
    "normalize_status",
]
