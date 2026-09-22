"""Authenticated encryption for secrets at rest (channel creds, tenant env).

AES-256-GCM via ``cryptography``. Key material comes from
``VERXIO_SECRETS_KEY`` (base64/hex, 32 bytes) or is derived with SHA-256 from
``VERXIO_CHANNEL_CRED_SECRET`` / ``VERXIO_AUTH_CODE_SECRET``. Blobs are
``v1:<base64url(nonce || ciphertext || tag)>``; the optional ``aad`` binds a
blob to its owner row so a ciphertext copied between tenants fails to open.
"""

from __future__ import annotations

import base64
import binascii
import hashlib
import os
import secrets

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_PREFIX = "v1:"
_NONCE_BYTES = 12


class SecretsBoxError(ValueError):
    pass


def _decode_key(raw: str) -> bytes | None:
    raw = raw.strip()
    if not raw:
        return None
    for decoder in (base64.b64decode, base64.urlsafe_b64decode):
        try:
            key = decoder(raw + "=" * (-len(raw) % 4))
            if len(key) == 32:
                return key
        except (binascii.Error, ValueError):
            continue
    try:
        key = bytes.fromhex(raw)
        if len(key) == 32:
            return key
    except ValueError:
        pass
    return None


def secrets_key() -> bytes:
    explicit = _decode_key(os.getenv("VERXIO_SECRETS_KEY", ""))
    if explicit is not None:
        return explicit
    seed = (
        os.getenv("VERXIO_CHANNEL_CRED_SECRET", "").strip()
        or os.getenv("VERXIO_AUTH_CODE_SECRET", "").strip()
        or "verxio-local-channel-secret"
    )
    return hashlib.sha256(seed.encode("utf-8")).digest()


def encrypt_text(plaintext: str, *, aad: str = "") -> str:
    nonce = secrets.token_bytes(_NONCE_BYTES)
    sealed = AESGCM(secrets_key()).encrypt(nonce, plaintext.encode("utf-8"), aad.encode("utf-8") or None)
    return _PREFIX + base64.urlsafe_b64encode(nonce + sealed).decode("ascii")


def decrypt_text(blob: str, *, aad: str = "") -> str:
    if not blob.startswith(_PREFIX):
        return _decrypt_legacy_xor(blob)
    try:
        raw = base64.urlsafe_b64decode(blob[len(_PREFIX) :].encode("ascii"))
    except (binascii.Error, ValueError) as exc:
        raise SecretsBoxError("Malformed secret blob") from exc
    if len(raw) <= _NONCE_BYTES:
        raise SecretsBoxError("Malformed secret blob")
    nonce, sealed = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
    try:
        return AESGCM(secrets_key()).decrypt(nonce, sealed, aad.encode("utf-8") or None).decode("utf-8")
    except InvalidTag as exc:
        raise SecretsBoxError("Secret blob failed authentication") from exc


def is_sealed(blob: str) -> bool:
    return blob.startswith(_PREFIX)


def _decrypt_legacy_xor(blob: str) -> str:
    """Open blobs written by the pre-GCM XOR scheme so rows can be re-sealed."""
    key = secrets_key()
    try:
        data = base64.urlsafe_b64decode(blob.encode("ascii"))
    except (binascii.Error, ValueError) as exc:
        raise SecretsBoxError("Malformed legacy blob") from exc
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data)).decode("utf-8")
