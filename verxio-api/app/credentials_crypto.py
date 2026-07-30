"""Encrypt/decrypt credential blobs stored for workspace integrations (e.g. Postiz)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets

from fastapi import HTTPException


def _json_dumps(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _secret() -> bytes:
    # Prefer the dedicated credentials secret. Keep reading legacy Pulse /
    # auth-code secrets so existing ciphertext keeps decrypting after Pulse
    # removal.
    raw = (
        os.getenv("VERXIO_CREDENTIALS_SECRET", "").strip()
        or os.getenv("VERXIO_PULSE_SECRET", "").strip()
        or os.getenv("VERXIO_AUTH_CODE_SECRET", "").strip()
    )
    if not raw:
        raw = "verxio-local-credentials-development-secret"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _keystream(length: int, salt: bytes) -> bytes:
    output = bytearray()
    counter = 0
    key = _secret()
    while len(output) < length:
        output.extend(hmac.new(key, salt + counter.to_bytes(4, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(output[:length])


def encrypt_credentials(credentials: dict[str, str]) -> str:
    if not credentials:
        return ""
    plaintext = _json_dumps(credentials).encode("utf-8")
    salt = secrets.token_bytes(16)
    stream = _keystream(len(plaintext), salt)
    ciphertext = bytes(left ^ right for left, right in zip(plaintext, stream))
    tag = hmac.new(_secret(), salt + ciphertext, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(salt + tag + ciphertext).decode("ascii")


def decrypt_credentials(value: str) -> dict[str, str]:
    if not value:
        return {}
    try:
        payload = base64.urlsafe_b64decode(value.encode("ascii"))
        salt, tag, ciphertext = payload[:16], payload[16:48], payload[48:]
        expected = hmac.new(_secret(), salt + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("invalid credential tag")
        stream = _keystream(len(ciphertext), salt)
        plaintext = bytes(left ^ right for left, right in zip(ciphertext, stream))
        decoded = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Stored credentials could not be decrypted.") from exc
    return {str(key): str(val) for key, val in decoded.items()} if isinstance(decoded, dict) else {}
