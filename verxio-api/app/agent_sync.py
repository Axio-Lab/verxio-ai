"""Shared agent-state sync between Verxio Desktop and the cloud Hermes.

Allowlisted ``HERMES_HOME`` paths (memory, skills, SOUL.md, agent config,
and a TTL ``outputs/`` folder) are stored per account. Desktop pulls on
launch and pushes on quit; pool workers attach the same files from the
tenant hermes-home after materialize.
"""

from __future__ import annotations

import hashlib
import os
from datetime import timedelta
from pathlib import Path
from typing import Any

import yaml
from fastapi import HTTPException

from app import db
from app.control_plane import get_runtime_for_user, now_iso
from app.models import AgentStateEntry, AgentStateManifest, utc_now

OUTPUTS_TTL_DAYS = 7
DEFAULT_QUOTA_BYTES = 64 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
CONFIG_AGENT_KEYS = ("agent",)
ALLOW_PREFIXES = ("memory/", "skills/", "outputs/")
ALLOW_FILES = frozenset({"soul.md", "config.yaml"})


def quota_bytes() -> int:
    raw = os.getenv("VERXIO_AGENT_STATE_QUOTA_BYTES", "").strip()
    if raw:
        try:
            return max(1, int(raw))
        except ValueError:
            pass
    return DEFAULT_QUOTA_BYTES


def normalize_path(path: str) -> str:
    cleaned = path.strip().lstrip("/").replace("\\", "/")
    while "//" in cleaned:
        cleaned = cleaned.replace("//", "/")
    if not cleaned or cleaned.startswith(".") or ".." in cleaned.split("/"):
        raise HTTPException(status_code=400, detail="Invalid agent state path.")
    return cleaned


def classify_path(path: str) -> str:
    lowered = path.lower()
    if lowered in ALLOW_FILES:
        return "file"
    for prefix in ALLOW_PREFIXES:
        if lowered == prefix.rstrip("/") or lowered.startswith(prefix):
            return prefix.rstrip("/")
    raise HTTPException(status_code=403, detail="Path is not in the agent state allowlist.")


def _outputs_expires() -> str:
    return (utc_now() + timedelta(days=OUTPUTS_TTL_DAYS)).isoformat()


def expire_outputs(user_id: str) -> int:
    now = now_iso()
    rows = db.fetch_all(
        "SELECT path FROM agent_state_files WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at <= ?",
        (user_id, now),
    )
    for row in rows:
        db.execute("DELETE FROM agent_state_files WHERE user_id = ? AND path = ?", (user_id, row["path"]))
    return len(rows)


def used_bytes(user_id: str) -> int:
    expire_outputs(user_id)
    row = db.fetch_one(
        "SELECT COALESCE(SUM(size_bytes), 0) AS used FROM agent_state_files WHERE user_id = ?",
        (user_id,),
    )
    return int((row or {}).get("used") or 0)


def list_state(user_id: str) -> AgentStateManifest:
    expire_outputs(user_id)
    rows = db.fetch_all(
        "SELECT path, etag, size_bytes, updated_by, updated_at, expires_at FROM agent_state_files WHERE user_id = ? ORDER BY path",
        (user_id,),
    )
    return AgentStateManifest(
        entries=[
            AgentStateEntry(
                path=str(row["path"]),
                etag=str(row["etag"]),
                sizeBytes=int(row["size_bytes"] or 0),
                updatedBy=str(row["updated_by"] or "desktop"),
                updatedAt=str(row["updated_at"]),
                expiresAt=row.get("expires_at"),
            )
            for row in rows
        ],
        usedBytes=used_bytes(user_id),
        quotaBytes=quota_bytes(),
    )


def _row_to_entry(row: dict[str, Any]) -> AgentStateEntry:
    return AgentStateEntry(
        path=str(row["path"]),
        etag=str(row["etag"]),
        sizeBytes=int(row["size_bytes"] or 0),
        updatedBy=str(row.get("updated_by") or "desktop"),
        updatedAt=str(row["updated_at"]),
        expiresAt=row.get("expires_at"),
    )


def get_file(user_id: str, path: str) -> tuple[bytes, AgentStateEntry]:
    rel = normalize_path(path)
    classify_path(rel)
    expire_outputs(user_id)
    row = db.fetch_one("SELECT * FROM agent_state_files WHERE user_id = ? AND path = ?", (user_id, rel))
    if not row:
        raise HTTPException(status_code=404, detail="Agent state file not found.")
    content = row.get("content")
    if content is None:
        raise HTTPException(status_code=404, detail="Agent state file has no content.")
    if isinstance(content, str):
        payload = content.encode("utf-8")
    else:
        payload = bytes(content)
    return payload, _row_to_entry(row)


def _merge_config(existing: bytes | None, incoming: bytes) -> bytes:
    try:
        next_payload = yaml.safe_load(incoming.decode("utf-8")) or {}
    except yaml.YAMLError as exc:
        raise HTTPException(status_code=400, detail=f"config.yaml is not valid YAML: {exc}") from exc
    if not isinstance(next_payload, dict):
        raise HTTPException(status_code=400, detail="config.yaml must be a mapping.")
    current: dict[str, Any] = {}
    if existing:
        try:
            parsed = yaml.safe_load(existing.decode("utf-8")) or {}
            if isinstance(parsed, dict):
                current = parsed
        except yaml.YAMLError:
            current = {}
    for key in CONFIG_AGENT_KEYS:
        if key in next_payload:
            current[key] = next_payload[key]
        elif key in current:
            continue
    return yaml.safe_dump(current, sort_keys=False).encode("utf-8")


def _materialize(user: dict[str, Any], rel: str, content: bytes) -> None:
    try:
        runtime = get_runtime_for_user(user)
    except Exception:
        return
    dest = Path(runtime.hermes_home_path) / rel
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    except OSError:
        return


def put_file(
    user: dict[str, Any],
    path: str,
    content: bytes,
    *,
    actor: str = "desktop",
    if_match: str | None = None,
) -> AgentStateEntry:
    user_id = str(user["id"])
    rel = normalize_path(path)
    kind = classify_path(rel)
    actor_name = (actor or "desktop").strip().lower() or "desktop"
    if actor_name not in {"desktop", "cloud"}:
        raise HTTPException(status_code=400, detail="updated_by must be desktop or cloud.")
    if kind == "outputs" and actor_name == "desktop":
        raise HTTPException(status_code=403, detail="outputs/ is read-only from the desktop.")
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="Agent state file is too large.")

    expire_outputs(user_id)
    existing = db.fetch_one("SELECT * FROM agent_state_files WHERE user_id = ? AND path = ?", (user_id, rel))
    if if_match:
        current_etag = str((existing or {}).get("etag") or "")
        if current_etag != if_match:
            raise HTTPException(status_code=412, detail="Agent state ETag does not match.")
    payload = content
    if rel.lower() == "config.yaml":
        existing_bytes = existing.get("content") if existing else None
        if isinstance(existing_bytes, str):
            existing_bytes = existing_bytes.encode("utf-8")
        payload = _merge_config(existing_bytes, content)

    next_used = used_bytes(user_id) - int((existing or {}).get("size_bytes") or 0) + len(payload)
    if next_used > quota_bytes():
        raise HTTPException(status_code=413, detail="Agent state quota exceeded.")

    etag = hashlib.sha256(payload).hexdigest()
    expires_at = _outputs_expires() if kind == "outputs" else None
    updated_at = now_iso()
    db.execute(
        """
        INSERT INTO agent_state_files (user_id, path, etag, size_bytes, updated_by, updated_at, expires_at, content)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, path) DO UPDATE SET
            etag = excluded.etag,
            size_bytes = excluded.size_bytes,
            updated_by = excluded.updated_by,
            updated_at = excluded.updated_at,
            expires_at = excluded.expires_at,
            content = excluded.content
        """,
        (user_id, rel, etag, len(payload), actor_name, updated_at, expires_at, payload),
    )
    _materialize(user, rel, payload)
    row = db.fetch_one("SELECT * FROM agent_state_files WHERE user_id = ? AND path = ?", (user_id, rel))
    if not row:
        raise HTTPException(status_code=500, detail="Could not store agent state.")
    return _row_to_entry(row)
