"""Shared hermes-home checkpoint / restore for scale-to-zero."""

from __future__ import annotations

import logging
from pathlib import Path

from app.models import RuntimeInstance
from app.runtime_orch.artifacts_store import get_artifact_store

logger = logging.getLogger(__name__)


def snapshot_key(runtime: RuntimeInstance) -> str:
    return f"runtimes/{runtime.workspace_id}/{runtime.agent_id}/hermes-home"


def checkpoint_hermes_home(runtime: RuntimeInstance) -> str | None:
    """Persist hermes-home to the configured artifact store. Returns store URI/path or None."""
    home = Path(runtime.hermes_home_path)
    if not home.exists():
        return None
    try:
        store = get_artifact_store()
        return store.put_directory(snapshot_key(runtime), home)
    except Exception:
        logger.exception("Checkpoint failed for runtime %s", runtime.id)
        return None


def restore_hermes_home(runtime: RuntimeInstance, *, only_if_missing: bool = True) -> bool:
    """Restore hermes-home from snapshot. Returns True if restored."""
    home = Path(runtime.hermes_home_path)
    if only_if_missing and home.exists() and any(home.iterdir()):
        return False
    try:
        store = get_artifact_store()
        key = snapshot_key(runtime)
        if not store.exists(key):
            return False
        home.parent.mkdir(parents=True, exist_ok=True)
        return store.restore_directory(key, home)
    except Exception:
        logger.exception("Restore failed for runtime %s", runtime.id)
        return False
