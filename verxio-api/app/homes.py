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


def snapshot_key(runtime: RuntimeInstance, part: str = "hermes-home") -> str:
    return f"homes/{runtime.workspace_id}/{runtime.agent_id}/{part}"


def worker_homes_root() -> Path | None:
    """Root for tenant homes on a pool worker (``VERXIO_WORKER_HOMES_ROOT``).

    Unset on the API/scheduler, where ``runtime.hermes_home_path`` (the legacy
    per-user layout) is still authoritative.
    """
    raw = os.getenv("VERXIO_WORKER_HOMES_ROOT", "").strip()
    return Path(raw).expanduser() if raw else None


def local_home_path(runtime: RuntimeInstance) -> Path:
    root = worker_homes_root()
    if root is None:
        return Path(runtime.hermes_home_path)
    return root / runtime.workspace_id / runtime.agent_id / "hermes-home"


def local_workspace_path(runtime: RuntimeInstance) -> Path:
    root = worker_homes_root()
    if root is None:
        return Path(runtime.workspace_path)
    return root / runtime.workspace_id / runtime.agent_id / "workspace"


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


def _restore_part(runtime: RuntimeInstance, part: str, target: Path, *, only_if_missing: bool) -> bool:
    if only_if_missing and target.exists() and any(target.iterdir()):
        return False
    store = get_artifact_store()
    key = snapshot_key(runtime, part)
    if not store.exists(key):
        target.mkdir(parents=True, exist_ok=True)
        return False
    target.parent.mkdir(parents=True, exist_ok=True)
    return store.restore_directory(key, target)


def restore_home(runtime: RuntimeInstance, *, only_if_missing: bool = True) -> bool:
    """Pull the tenant's hermes-home (and workspace) from object storage.

    Returns True when at least one part was restored from a snapshot.
    """
    restored_home = _restore_part(runtime, "hermes-home", local_home_path(runtime), only_if_missing=only_if_missing)
    restored_ws = _restore_part(runtime, "workspace", local_workspace_path(runtime), only_if_missing=only_if_missing)
    return restored_home or restored_ws


def _sync_part(runtime: RuntimeInstance, part: str, source: Path) -> str | None:
    if not source.exists():
        return None
    size = home_size_bytes(source)
    quota = home_quota_bytes()
    if size > quota:
        logger.warning(
            "Tenant %s over quota runtime=%s size=%s quota=%s",
            part,
            runtime.id,
            size,
            quota,
        )
    staging = source.parent / f"{source.name}.sync"
    if staging.exists():
        shutil.rmtree(staging)
    copy_home_filtered(source, staging)
    try:
        return get_artifact_store().put_directory(snapshot_key(runtime, part), staging)
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def sync_home(runtime: RuntimeInstance) -> str | None:
    """Push hermes-home + workspace snapshots. Returns the home snapshot ref."""
    ref = _sync_part(runtime, "hermes-home", local_home_path(runtime))
    _sync_part(runtime, "workspace", local_workspace_path(runtime))
    return ref


def write_home_env(home: Path, env: dict[str, str]) -> Path:
    """Merge ``env`` into ``{home}/.env`` (Hermes profile secret scope reads it).

    Keys already present are overwritten; unrelated keys the tenant set from the
    dashboard are preserved.
    """
    home.mkdir(parents=True, exist_ok=True)
    env_path = home / ".env"
    existing: dict[str, str] = {}
    order: list[str] = []
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8", errors="replace").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            if key.startswith("export "):
                key = key[7:].strip()
            existing[key] = value
            order.append(key)
    for key, value in env.items():
        if not key:
            continue
        if key not in existing:
            order.append(key)
        existing[key] = _quote_env_value(value)
    lines = [f"{key}={existing[key]}" for key in order]
    tmp = env_path.with_suffix(".env.tmp")
    tmp.write_text("\n".join(lines) + "\n", encoding="utf-8")
    os.chmod(tmp, 0o600)
    os.replace(tmp, env_path)
    return env_path


def _quote_env_value(value: str) -> str:
    text = str(value)
    if text == "" or any(ch in text for ch in (" ", "#", "\n", "'", '"')):
        escaped = text.replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
        return f'"{escaped}"'
    return text
