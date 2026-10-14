"""Per-user Tavus API keys. The desktop stores a copy locally; calls use this sealed copy."""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import Iterator

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import acurrent_user_or_device, arequire_user_or_device
from app.secrets_box import SecretsBoxError, decrypt_text, encrypt_text

KEY_REQUIRED = "Add your Tavus API key in Tools & Keys."
_AAD = "tavus-key:{user_id}"
_user_id: ContextVar[str] = ContextVar("tavus_user_id", default="")

router = APIRouter()


def current_user_id() -> str:
    return _user_id.get()


@contextmanager
def using_user(user_id: str) -> Iterator[None]:
    token = _user_id.set(user_id)
    try:
        yield
    finally:
        _user_id.reset(token)


def _aad(user_id: str) -> str:
    return _AAD.format(user_id=user_id)


def _row(user_id: str) -> dict | None:
    if not user_id:
        return None
    return db.fetch_one("SELECT * FROM tavus_user_accounts WHERE user_id = ?", (user_id,))


def load_key(user_id: str) -> str:
    row = _row(user_id)
    blob = str((row or {}).get("api_key_ciphertext") or "")
    if not blob:
        return ""
    try:
        return decrypt_text(blob, aad=_aad(user_id)).strip()
    except SecretsBoxError:
        return ""


def current_api_key() -> str:
    return load_key(current_user_id())


def user_has_key(user_id: str | None = None) -> bool:
    return bool(load_key(user_id or current_user_id()))


def _drop_remote_personality(user_id: str) -> None:
    """A personality created with another key stays on that Tavus account."""
    db.execute(
        """
        UPDATE tavus_profiles
        SET pal_id = '', share_pal_id = '', deployment_id = '', share_url = '', updated_at = ?
        WHERE user_id = ?
        """,
        (now_iso(), user_id),
    )


def save_user_key(user_id: str, api_key: str) -> None:
    api_key = api_key.strip()
    if not api_key:
        raise HTTPException(status_code=400, detail="Enter a Tavus API key.")
    previous = load_key(user_id)
    blob = encrypt_text(api_key, aad=_aad(user_id))
    now = now_iso()
    if _row(user_id):
        if previous == api_key:
            db.execute(
                "UPDATE tavus_user_accounts SET api_key_ciphertext = ?, updated_at = ? WHERE user_id = ?",
                (blob, now, user_id),
            )
            return
        db.execute(
            """
            UPDATE tavus_user_accounts
            SET api_key_ciphertext = ?, tool_id = '', guardrail_id = '', updated_at = ?
            WHERE user_id = ?
            """,
            (blob, now, user_id),
        )
    else:
        db.execute(
            """
            INSERT INTO tavus_user_accounts (user_id, api_key_ciphertext, tool_id, guardrail_id, updated_at)
            VALUES (?, ?, '', '', ?)
            """,
            (user_id, blob, now),
        )
    _drop_remote_personality(user_id)


def clear_user_key(user_id: str) -> None:
    db.execute("DELETE FROM tavus_user_accounts WHERE user_id = ?", (user_id,))
    _drop_remote_personality(user_id)


def bind_token(user_id: str) -> Token[str]:
    return _user_id.set(user_id)


def reset_token(token: Token[str]) -> None:
    _user_id.reset(token)


_PUBLIC_PREFIXES = (
    "/api/tavus/webhooks/",
    "/api/tavus/tools/start-task",
    "/api/tavus/files/",
)


async def tavus_user_middleware(request: Request, call_next):
    path = request.url.path
    token: Token[str] | None = None
    if path.startswith("/api/tavus/") and not path.startswith(_PUBLIC_PREFIXES):
        user = await acurrent_user_or_device(request)
        if user:
            token = bind_token(str(user["id"]))
    try:
        return await call_next(request)
    finally:
        if token is not None:
            reset_token(token)


@router.get("/api/tavus/credential")
async def get_credential_route(request: Request) -> dict[str, bool]:
    user = await arequire_user_or_device(request)
    return {"configured": user_has_key(str(user["id"]))}


@router.put("/api/tavus/credential")
async def put_credential_route(request: Request) -> dict[str, bool]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Credential payload must be an object.")
    save_user_key(str(user["id"]), str(payload.get("apiKey") or ""))
    return {"configured": True}


@router.delete("/api/tavus/credential")
async def delete_credential_route(request: Request) -> dict[str, bool]:
    user = await arequire_user_or_device(request)
    clear_user_key(str(user["id"]))
    return {"configured": False}
