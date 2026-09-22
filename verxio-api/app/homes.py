"""Tenant hermes-home restore/sync to S3-compatible storage."""

from __future__ import annotations

import logging
import os
import shutil
from pathlib import Path

from app.models import RuntimeInstance
from app.runtime_orch.artifacts_store import get_artifact_store

logger = logging.getLogger(__name__)

EXCLUDE_DIR_NAMES = {
    "cache",
    "audio_cache",
    ".cache",
    "node_modules",
    ".git",
    "audit-batch-b",
    "audit-repos",
}
EXCLUDE_SUFFIXES = (".bak", ".tmp")


def home_quota_bytes() -> int:
    raw = os.getenv("VERXIO_HOME_QUOTA_GB", "4")
    try:
        return max(1, int(float(raw))) * 1024 * 1024 * 1024
    except ValueError:
        return 4 * 1024 * 1024 * 1024


def snapshot_key(runtime: RuntimeInstance) -> str:
    return f"homes/{runtime.workspace_id}/{runtime.agent_id}/hermes-home"


def home_size_bytes(root: Path) -> int:
    total = 0
    if not root.exists():
        return 0
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [name for name in dirnames if name not in EXCLUDE_DIR_NAMES]
        for name in filenames:
            path = Path(dirpath) / name
            try:
                total += path.stat().st_size
            except OSError:
                continue
    return total


def copy_home_filtered(source: Path, dest: Path) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        if item.name in EXCLUDE_DIR_NAMES:
            continue
        if item.name.endswith(EXCLUDE_SUFFIXES) or ".bak-" in item.name:
            continue
        target = dest / item.name
        if item.is_dir():
            shutil.copytree(item, target, dirs_exist_ok=True, ignore=_ignore)
        elif item.is_file():
            shutil.copy2(item, target)


def _ignore(directory: str, names: list[str]) -> set[str]:
    skipped = {name for name in names if name in EXCLUDE_DIR_NAMES}
    skipped.update(name for name in names if name.endswith(EXCLUDE_SUFFIXES) or ".bak-" in name)
    return skipped


def restore_home(runtime: RuntimeInstance, *, only_if_missing: bool = True) -> bool:
    home = Path(runtime.hermes_home_path)
    if only_if_missing and home.exists() and any(home.iterdir()):
        return False
    store = get_artifact_store()
    key = snapshot_key(runtime)
    if not store.exists(key):
        return False
    home.parent.mkdir(parents=True, exist_ok=True)
    return store.restore_directory(key, home)


def sync_home(runtime: RuntimeInstance) -> str | None:
    home = Path(runtime.hermes_home_path)
    if not home.exists():
        return None
    size = home_size_bytes(home)
    quota = home_quota_bytes()
    if size > quota:
        logger.warning(
            "Tenant home over quota runtime=%s size=%s quota=%s",
            runtime.id,
            size,
            quota,
        )
    staging = home.parent / f"{home.name}.sync"
    if staging.exists():
        shutil.rmtree(staging)
    copy_home_filtered(home, staging)
    try:
        return get_artifact_store().put_directory(snapshot_key(runtime), staging)
    finally:
        shutil.rmtree(staging, ignore_errors=True)
