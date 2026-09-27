"""Device tokens for Verxio Desktop.

The desktop app signs in once with the normal cookie session, then mints a
long-lived device token. The local Hermes on the user's machine presents that
token as a Bearer credential to the cloud inference gateway, the Composio MCP
proxy and the agent state sync API. Tokens are stored hashed (SHA-256); the
plaintext is only returned once, at creation.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

from fastapi import HTTPException, Request

from app import db
from app.auth import aget_current_user, get_current_user
from app.control_plane import now_iso
from app.models import DeviceToken, DeviceTokenCreateRequest, DeviceTokenCreateResponse, new_id

TOKEN_PREFIX = "vxd_"
_LAST_USED_WRITE_INTERVAL_SECONDS = 60.0
_last_used_written: dict[str, float] = {}


def hash_device_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _row_to_model(row: dict[str, Any]) -> DeviceToken:
    return DeviceToken(
        id=str(row["id"]),
        name=str(row.get("name") or ""),
        platform=str(row.get("platform") or ""),
        createdAt=str(row["created_at"]),
        lastUsedAt=row.get("last_used_at"),
        revokedAt=row.get("revoked_at"),
    )


def issue_device_token(user_id: str, payload: DeviceTokenCreateRequest) -> DeviceTokenCreateResponse:
    token = TOKEN_PREFIX + secrets.token_urlsafe(40)
    created_at = now_iso()
    token_id = new_id("dev")
    db.execute(
        """
        INSERT INTO device_tokens (id, user_id, token_hash, name, platform, last_used_at, revoked_at, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, NULL, ?)
        """,
        (token_id, user_id, hash_device_token(token), payload.name.strip(), payload.platform.strip(), created_at),
    )
    row = db.fetch_one("SELECT * FROM device_tokens WHERE id = ?", (token_id,))
    if not row:
        raise HTTPException(status_code=500, detail="Could not create device token.")
    return DeviceTokenCreateResponse(token=token, device=_row_to_model(row))


def list_device_tokens(user_id: str) -> list[DeviceToken]:
    rows = db.fetch_all(
        "SELECT * FROM device_tokens WHERE user_id = ? AND revoked_at IS NULL ORDER BY created_at DESC",
        (user_id,),
    )
    return [_row_to_model(row) for row in rows]


def revoke_device_token(user_id: str, token_id: str) -> DeviceToken:
    row = db.fetch_one("SELECT * FROM device_tokens WHERE id = ? AND user_id = ?", (token_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Device token not found.")
    if not row.get("revoked_at"):
        db.execute("UPDATE device_tokens SET revoked_at = ? WHERE id = ?", (now_iso(), token_id))
        row = db.fetch_one("SELECT * FROM device_tokens WHERE id = ?", (token_id,)) or row
    _last_used_written.pop(str(row["token_hash"]), None)
    return _row_to_model(row)


def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        return None
    token = header[7:].strip()
    return token or None


def _touch_last_used(token_hash: str) -> None:
    now = time.monotonic()
    last = _last_used_written.get(token_hash, 0.0)
    if now - last < _LAST_USED_WRITE_INTERVAL_SECONDS:
        return
    _last_used_written[token_hash] = now
    db.execute("UPDATE device_tokens SET last_used_at = ? WHERE token_hash = ?", (now_iso(), token_hash))


def user_from_device_token(token: str) -> dict[str, Any] | None:
    if not token.startswith(TOKEN_PREFIX):
        return None
    token_hash = hash_device_token(token)
    row = db.fetch_one(
        """
        SELECT u.*, d.id AS device_token_id FROM device_tokens d
        JOIN users u ON u.id = d.user_id
        WHERE d.token_hash = ? AND d.revoked_at IS NULL
        LIMIT 1
        """,
        (token_hash,),
    )
    if not row:
        return None
    _touch_last_used(token_hash)
    return row


def current_user_or_device(request: Request) -> dict[str, Any] | None:
    """Cookie session first, then a desktop device token."""
    user = get_current_user(request)
    if user:
        return user
    token = bearer_token(request)
    if not token:
        return None
    return user_from_device_token(token)


async def acurrent_user_or_device(request: Request) -> dict[str, Any] | None:
    user = await aget_current_user(request)
    if user:
        return user
    token = bearer_token(request)
    if not token:
        return None
    return user_from_device_token(token)


def require_user_or_device(request: Request) -> dict[str, Any]:
    user = current_user_or_device(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def arequire_user_or_device(request: Request) -> dict[str, Any]:
    user = await acurrent_user_or_device(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user
