"""Encrypted channel credential store (Baileys creds, bot tokens)."""

from __future__ import annotations

import base64
import hashlib
import os
from typing import Any

from app import db
from app.channels.shards import shard_key
from app.control_plane import now_iso
from app.models import new_id


def _secret() -> bytes:
    raw = (
        os.getenv("VERXIO_CHANNEL_CRED_SECRET", "").strip()
        or os.getenv("VERXIO_AUTH_CODE_SECRET", "").strip()
        or "verxio-local-channel-secret"
    )
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _xor(data: bytes) -> bytes:
    key = _secret()
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def encrypt_blob(plaintext: str) -> str:
    return base64.urlsafe_b64encode(_xor(plaintext.encode("utf-8"))).decode("ascii")


def decrypt_blob(ciphertext: str) -> str:
    return _xor(base64.urlsafe_b64decode(ciphertext.encode("ascii"))).decode("utf-8")


def upsert_credential(
    *,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    platform: str,
    plaintext: str,
) -> str:
    now = now_iso()
    existing = db.fetch_one(
        """
        SELECT id FROM channel_credentials
        WHERE workspace_id = ? AND agent_id = ? AND platform = ?
        """,
        (workspace_id, agent_id, platform),
    )
    blob = encrypt_blob(plaintext)
    key = shard_key(workspace_id, agent_id)
    if existing:
        db.execute(
            """
            UPDATE channel_credentials
            SET ciphertext = ?, shard_key = ?, updated_at = ?
            WHERE id = ?
            """,
            (blob, key, now, existing["id"]),
        )
        return str(existing["id"])
    cred_id = new_id("cred")
    db.execute(
        """
        INSERT INTO channel_credentials (
            id, tenant_id, workspace_id, agent_id, platform, shard_key,
            ciphertext, restored_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
        """,
        (cred_id, tenant_id, workspace_id, agent_id, platform, key, blob, now, now),
    )
    return cred_id


def load_credential(workspace_id: str, agent_id: str, platform: str) -> str | None:
    row = db.fetch_one(
        """
        SELECT ciphertext FROM channel_credentials
        WHERE workspace_id = ? AND agent_id = ? AND platform = ?
        """,
        (workspace_id, agent_id, platform),
    )
    if not row:
        return None
    return decrypt_blob(str(row["ciphertext"]))


def list_shard_credentials(shard: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT * FROM channel_credentials WHERE shard_key = ?",
        (shard,),
    )
    out = []
    for row in rows:
        item = dict(row)
        item["plaintext"] = decrypt_blob(str(row["ciphertext"]))
        item.pop("ciphertext", None)
        out.append(item)
    return out
