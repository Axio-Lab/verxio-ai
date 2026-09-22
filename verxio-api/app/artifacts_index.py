"""Artifact index-on-write for pool tenants.

Workers scan a tenant's workspace after every turn, upload new/changed files
to object storage under ``artifacts/{ws}/{agent}/{relative_path}`` and upsert
the shared ``artifacts`` table. Rows written this way carry
``absolute_path = objstore://<key>`` so the API can serve them via a signed
URL (S3) or a local stream (LocalArtifactStore) without any docker exec or
shared filesystem.
"""

from __future__ import annotations

import logging
import mimetypes
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app import db
from app.models import ArtifactRecord, RuntimeInstance, new_id
from app.runtime_orch.artifacts_store import get_artifact_store

logger = logging.getLogger(__name__)

OBJSTORE_PREFIX = "objstore://"
SKIP_DIRS = {
    "node_modules",
    ".git",
    ".venv",
    "venv",
    "__pycache__",
    ".next",
    "dist",
    "build",
    ".cache",
    ".turbo",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "target",
}
MAX_FILES = 2_000
MAX_FILE_BYTES = 256 * 1024 * 1024


def artifact_object_key(runtime: RuntimeInstance, relative_path: str) -> str:
    return f"artifacts/{runtime.workspace_id}/{runtime.agent_id}/{relative_path}"


def is_objstore_path(absolute_path: str) -> bool:
    return str(absolute_path or "").startswith(OBJSTORE_PREFIX)


def objstore_key(absolute_path: str) -> str:
    return str(absolute_path)[len(OBJSTORE_PREFIX) :]


def _mtime_iso(stat_result: os.stat_result) -> str:
    return datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc).isoformat()


def _sha256(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _iter_files(root: Path):
    count = 0
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [name for name in dirnames if name not in SKIP_DIRS and not name.startswith(".sync")]
        current = Path(dirpath)
        for name in filenames:
            if name.startswith(".") and name.endswith(".tmp"):
                continue
            count += 1
            if count > MAX_FILES:
                logger.warning("Artifact index capped at %d files under %s", MAX_FILES, root)
                return
            yield current / name


def index_workspace_artifacts(
    runtime: RuntimeInstance,
    workspace_dir: Path,
    *,
    job_id: str = "",
    source: str = "workspace",
) -> list[ArtifactRecord]:
    """Upload changed files and upsert ``artifacts`` rows. Returns changed records."""
    if not workspace_dir.is_dir():
        return []
    store = get_artifact_store()
    changed: list[ArtifactRecord] = []
    seen: set[str] = set()
    for path in _iter_files(workspace_dir):
        try:
            stat = path.stat()
        except OSError:
            continue
        if not path.is_file() or stat.st_size > MAX_FILE_BYTES:
            continue
        relative = path.relative_to(workspace_dir).as_posix()
        seen.add(relative)
        mtime_iso = _mtime_iso(stat)
        existing = db.fetch_one(
            """
            SELECT id, size_bytes, sha256, absolute_path, updated_at
            FROM artifacts
            WHERE workspace_id = ? AND agent_id = ? AND relative_path = ?
            """,
            (runtime.workspace_id, runtime.agent_id, relative),
        )
        if (
            existing
            and int(existing.get("size_bytes") or 0) == stat.st_size
            and str(existing.get("updated_at") or "") == mtime_iso
            and is_objstore_path(str(existing.get("absolute_path") or ""))
        ):
            continue
        digest = _sha256(path)
        if existing and str(existing.get("sha256") or "") == digest and is_objstore_path(
            str(existing.get("absolute_path") or "")
        ):
            # Touched but byte-identical: refresh the timestamp only.
            db.execute(
                "UPDATE artifacts SET updated_at = ? WHERE id = ?",
                (mtime_iso, existing["id"]),
            )
            continue
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        key = artifact_object_key(runtime, relative)
        try:
            store.put_file(key, path, content_type=content_type)
        except Exception:
            logger.exception("Artifact upload failed key=%s", key)
            continue
        absolute = OBJSTORE_PREFIX + key
        if existing:
            db.execute(
                """
                UPDATE artifacts
                SET file_name = ?, absolute_path = ?, content_type = ?, size_bytes = ?, sha256 = ?,
                    source = ?, updated_at = ?
                WHERE id = ?
                """,
                (path.name, absolute, content_type, stat.st_size, digest, source, mtime_iso, existing["id"]),
            )
            artifact_id = str(existing["id"])
        else:
            artifact_id = new_id("art")
            db.execute(
                """
                INSERT INTO artifacts (
                    id, tenant_id, workspace_id, agent_id, file_name, relative_path, absolute_path,
                    content_type, size_bytes, sha256, source, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    artifact_id,
                    runtime.tenant_id,
                    runtime.workspace_id,
                    runtime.agent_id,
                    path.name,
                    relative,
                    absolute,
                    content_type,
                    stat.st_size,
                    digest,
                    source,
                    mtime_iso,
                    mtime_iso,
                ),
            )
        changed.append(
            ArtifactRecord(
                id=artifact_id,
                tenant_id=runtime.tenant_id,
                workspace_id=runtime.workspace_id,
                agent_id=runtime.agent_id,
                file_name=path.name,
                relative_path=relative,
                content_type=content_type,
                size_bytes=stat.st_size,
                source=source,
                created_at=mtime_iso,
                updated_at=mtime_iso,
            )
        )
    _remove_vanished(runtime, seen, store)
    if changed:
        logger.info(
            "Indexed %d artifact(s) tenant=%s:%s job=%s",
            len(changed),
            runtime.workspace_id,
            runtime.agent_id,
            job_id,
        )
    return changed


def _remove_vanished(runtime: RuntimeInstance, seen: set[str], store: Any) -> None:
    rows = db.fetch_all(
        """
        SELECT id, relative_path, absolute_path FROM artifacts
        WHERE workspace_id = ? AND agent_id = ? AND absolute_path LIKE ?
        """,
        (runtime.workspace_id, runtime.agent_id, OBJSTORE_PREFIX + "%"),
    )
    for row in rows:
        relative = str(row.get("relative_path") or "")
        if relative in seen:
            continue
        try:
            store.delete(objstore_key(str(row["absolute_path"])))
        except Exception:
            logger.debug("Artifact object delete failed %s", row["absolute_path"], exc_info=True)
        db.execute("DELETE FROM artifacts WHERE id = ?", (row["id"],))


def list_indexed_artifacts(runtime: RuntimeInstance) -> list[ArtifactRecord]:
    rows = db.fetch_all(
        """
        SELECT id, tenant_id, workspace_id, agent_id, file_name, relative_path,
               content_type, size_bytes, source, created_at, updated_at
        FROM artifacts
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC, created_at DESC, file_name ASC
        """,
        (runtime.workspace_id, runtime.agent_id),
    )
    return [ArtifactRecord(**row) for row in rows]


def objstore_artifact(runtime: RuntimeInstance, artifact_id: str) -> tuple[ArtifactRecord, str]:
    """Return ``(record, object_key)`` for an objstore-backed artifact."""
    row = db.fetch_one(
        """
        SELECT id, tenant_id, workspace_id, agent_id, file_name, relative_path,
               absolute_path, content_type, size_bytes, source, created_at, updated_at
        FROM artifacts
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (artifact_id, runtime.workspace_id, runtime.agent_id),
    )
    if not row or not is_objstore_path(str(row.get("absolute_path") or "")):
        raise KeyError("Artifact not found.")
    public = {key: value for key, value in row.items() if key != "absolute_path"}
    return ArtifactRecord(**public), objstore_key(str(row["absolute_path"]))


def signed_download_url(key: str, *, expires: int = 900) -> str | None:
    store = get_artifact_store()
    signer = getattr(store, "signed_url", None)
    if signer is None:
        return None
    try:
        return signer(key, expires=expires, raw=True)
    except TypeError:
        return None
