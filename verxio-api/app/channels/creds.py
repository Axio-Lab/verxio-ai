"""Encrypted channel credential store (Baileys creds, bot tokens)."""

from __future__ import annotations

from typing import Any

from app import db
from app.channels.shards import shard_key
from app.control_plane import now_iso
from app.models import new_id
from app.secrets_box import decrypt_text, encrypt_text, is_sealed


def _aad(workspace_id: str, agent_id: str, platform: str) -> str:
    return f"channel:{workspace_id}:{agent_id}:{platform}"


def encrypt_blob(plaintext: str, *, workspace_id: str = "", agent_id: str = "", platform: str = "") -> str:
    return encrypt_text(plaintext, aad=_aad(workspace_id, agent_id, platform))


def decrypt_blob(ciphertext: str, *, workspace_id: str = "", agent_id: str = "", platform: str = "") -> str:
    return decrypt_text(ciphertext, aad=_aad(workspace_id, agent_id, platform))


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
    blob = encrypt_blob(plaintext, workspace_id=workspace_id, agent_id=agent_id, platform=platform)
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


def _open_row(row: dict[str, Any]) -> str:
    workspace_id = str(row["workspace_id"])
    agent_id = str(row["agent_id"])
    platform = str(row["platform"])
    blob = str(row["ciphertext"])
    plaintext = decrypt_blob(blob, workspace_id=workspace_id, agent_id=agent_id, platform=platform)
    if not is_sealed(blob):
        # Re-seal legacy XOR rows with AES-GCM on first read.
        db.execute(
            "UPDATE channel_credentials SET ciphertext = ?, updated_at = ? WHERE id = ?",
            (
                encrypt_blob(plaintext, workspace_id=workspace_id, agent_id=agent_id, platform=platform),
                now_iso(),
                row["id"],
            ),
        )
    return plaintext


def load_credential(workspace_id: str, agent_id: str, platform: str) -> str | None:
    row = db.fetch_one(
        """
        SELECT * FROM channel_credentials
        WHERE workspace_id = ? AND agent_id = ? AND platform = ?
        """,
        (workspace_id, agent_id, platform),
    )
    if not row:
        return None
    return _open_row(row)


def delete_credential(workspace_id: str, agent_id: str, platform: str) -> bool:
    row = db.fetch_one(
        "SELECT id FROM channel_credentials WHERE workspace_id = ? AND agent_id = ? AND platform = ?",
        (workspace_id, agent_id, platform),
    )
    if not row:
        return False
    db.execute("DELETE FROM channel_credentials WHERE id = ?", (row["id"],))
    return True


def mark_restored(workspace_id: str, agent_id: str, platform: str) -> None:
    db.execute(
        """
        UPDATE channel_credentials SET restored_at = ?
        WHERE workspace_id = ? AND agent_id = ? AND platform = ?
        """,
        (now_iso(), workspace_id, agent_id, platform),
    )


def list_shard_credentials(shard: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT * FROM channel_credentials WHERE shard_key = ?",
        (shard,),
    )
    out = []
    for row in rows:
        item = dict(row)
        item["plaintext"] = _open_row(row)
        item.pop("ciphertext", None)
        out.append(item)
    return out
