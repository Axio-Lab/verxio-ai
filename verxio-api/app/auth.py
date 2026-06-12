from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
from datetime import timedelta
from typing import Any

from fastapi import HTTPException, Request, Response

from app import db
from app.control_plane import ensure_personal_workspace, now_iso, record_audit
from app.models import AuthResponse, LoginRequest, SignupRequest, UserPublic, new_id, utc_now


SESSION_COOKIE = os.getenv("VERXIO_SESSION_COOKIE", "verxio_session")
SESSION_DAYS = int(os.getenv("VERXIO_SESSION_DAYS", "7"))
PBKDF2_ITERATIONS = 210_000


def normalize_email(email: str) -> str:
    return email.strip().lower()


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS)
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, stored: str) -> bool:
    try:
        algorithm, iterations_raw, salt_raw, digest_raw = stored.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_raw)
        salt = base64.urlsafe_b64decode(salt_raw.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_raw.encode("ascii"))
    except Exception:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual, expected)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def user_public(row: dict[str, Any]) -> UserPublic:
    return UserPublic(id=str(row["id"]), email=str(row["email"]), name=str(row["name"]))


def set_session_cookie(response: Response, token: str) -> None:
    secure = os.getenv("VERXIO_COOKIE_SECURE", "false").strip().lower() in {"1", "true", "yes", "on"}
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=secure,
        samesite="lax",
        path="/",
    )


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE, path="/")


def create_session(user: dict[str, Any], request: Request, response: Response) -> None:
    token = secrets.token_urlsafe(40)
    created_at = now_iso()
    expires_at = (utc_now() + timedelta(days=SESSION_DAYS)).isoformat()
    db.execute(
        """
        INSERT INTO sessions (
            id, user_id, token_hash, expires_at, ip_address, user_agent, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("sess"),
            user["id"],
            hash_session_token(token),
            expires_at,
            request.client.host if request.client else None,
            request.headers.get("user-agent"),
            created_at,
            created_at,
        ),
    )
    set_session_cookie(response, token)


def get_current_user(request: Request) -> dict[str, Any] | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None

    row = db.fetch_one(
        """
        SELECT u.* FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ? AND s.expires_at > ?
        LIMIT 1
        """,
        (hash_session_token(token), now_iso()),
    )
    return row


def require_user(request: Request) -> dict[str, Any]:
    user = get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


def signup(payload: SignupRequest, request: Request, response: Response) -> AuthResponse:
    email = normalize_email(payload.email)
    existing = db.fetch_one("SELECT id FROM users WHERE email = ?", (email,))
    if existing:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    created_at = now_iso()
    user_id = new_id("user")
    user = {
        "id": user_id,
        "email": email,
        "name": payload.name.strip(),
        "password_hash": hash_password(payload.password),
    }
    db.execute(
        """
        INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        """,
        (user["id"], user["email"], user["name"], user["password_hash"], created_at, created_at),
    )

    stored = db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
    if not stored:
        raise HTTPException(status_code=500, detail="Could not create user.")

    workspace, agent, _runtime = ensure_personal_workspace(stored)
    create_session(stored, request, response)
    record_audit(
        tenant_id=stored["id"],
        workspace_id=workspace.id,
        agent_id=agent.id,
        actor="Verxio",
        action="auth.signup",
        summary="Created user, personal workspace, and default Hermes-backed agent.",
        status="success",
    )
    return AuthResponse(user=user_public(stored), workspace=workspace, profile=agent)


def login(payload: LoginRequest, request: Request, response: Response) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not verify_password(payload.password, str(user["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    workspace, agent, _runtime = ensure_personal_workspace(user)
    create_session(user, request, response)
    record_audit(
        tenant_id=user["id"],
        workspace_id=workspace.id,
        agent_id=agent.id,
        actor="Verxio",
        action="auth.login",
        summary="User logged into their Verxio workspace.",
        status="success",
    )
    return AuthResponse(user=user_public(user), workspace=workspace, profile=agent)


def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))
    clear_session_cookie(response)
    return {"ok": True}


def me(user: dict[str, Any]) -> AuthResponse:
    workspace, agent, _runtime = ensure_personal_workspace(user)
    return AuthResponse(user=user_public(user), workspace=workspace, profile=agent)
