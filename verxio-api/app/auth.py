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
from app.emailer import AuthCodePurpose, send_auth_code_email
from app.models import (
    AuthCodeChallengeResponse,
    AuthCodeVerifyRequest,
    AuthResponse,
    EmailRequest,
    LoginRequest,
    PasswordResetRequest,
    SignupRequest,
    UserPublic,
    new_id,
    utc_now,
)


SESSION_COOKIE = os.getenv("VERXIO_SESSION_COOKIE", "verxio_session")
SESSION_DAYS = int(os.getenv("VERXIO_SESSION_DAYS", "7"))
PBKDF2_ITERATIONS = 210_000
AUTH_CODE_MAX_ATTEMPTS = int(os.getenv("VERXIO_AUTH_CODE_MAX_ATTEMPTS", "5"))


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


def _auth_code_ttl_minutes() -> int:
    return max(1, int(os.getenv("VERXIO_AUTH_CODE_TTL_MINUTES", "10")))


def _auth_code_secret() -> bytes:
    secret = (
        os.getenv("VERXIO_AUTH_CODE_SECRET", "").strip()
        or os.getenv("SECRET_KEY", "").strip()
        or "verxio-local-auth-code-secret"
    )
    return secret.encode("utf-8")


def generate_auth_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def hash_auth_code(email: str, purpose: AuthCodePurpose, code: str) -> str:
    payload = f"{normalize_email(email)}:{purpose}:{code}".encode("utf-8")
    return hmac.new(_auth_code_secret(), payload, hashlib.sha256).hexdigest()


def _challenge_response(email: str, purpose: AuthCodePurpose) -> AuthCodeChallengeResponse:
    return AuthCodeChallengeResponse(
        email=normalize_email(email),
        purpose=purpose,
        expiresInSeconds=_auth_code_ttl_minutes() * 60,
    )


def create_auth_code_challenge(
    *,
    email: str,
    purpose: AuthCodePurpose,
    user_id: str | None,
    deliver: bool = True,
) -> AuthCodeChallengeResponse:
    email = normalize_email(email)
    if not deliver:
        return _challenge_response(email, purpose)

    code = generate_auth_code()
    created_at = now_iso()
    expires_minutes = _auth_code_ttl_minutes()
    expires_at = (utc_now() + timedelta(minutes=expires_minutes)).isoformat()
    code_hash = hash_auth_code(email, purpose, code)

    with db.transaction() as conn:
        conn.execute(
            """
            UPDATE auth_codes
            SET consumed_at = ?
            WHERE email = ? AND purpose = ? AND consumed_at IS NULL
            """,
            (created_at, email, purpose),
        )
        conn.execute(
            """
            INSERT INTO auth_codes (
                id, email, user_id, purpose, code_hash, attempts, expires_at, consumed_at, created_at
            )
            VALUES (?, ?, ?, ?, ?, 0, ?, NULL, ?)
            """,
            (new_id("code"), email, user_id, purpose, code_hash, expires_at, created_at),
        )

    send_auth_code_email(to_email=email, purpose=purpose, code=code, expires_minutes=expires_minutes)
    return _challenge_response(email, purpose)


def consume_auth_code(email: str, purpose: AuthCodePurpose, code: str) -> dict[str, Any]:
    email = normalize_email(email)
    row = db.fetch_one(
        """
        SELECT *
        FROM auth_codes
        WHERE email = ? AND purpose = ? AND consumed_at IS NULL
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (email, purpose),
    )
    if not row:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    now = now_iso()
    if str(row["expires_at"]) <= now:
        db.execute("UPDATE auth_codes SET consumed_at = ? WHERE id = ?", (now, row["id"]))
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    attempts = int(row.get("attempts") or 0)
    if attempts >= AUTH_CODE_MAX_ATTEMPTS:
        db.execute("UPDATE auth_codes SET consumed_at = ? WHERE id = ?", (now, row["id"]))
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    expected = str(row["code_hash"])
    actual = hash_auth_code(email, purpose, code)
    if not hmac.compare_digest(actual, expected):
        attempts += 1
        consumed_at = now if attempts >= AUTH_CODE_MAX_ATTEMPTS else None
        db.execute(
            "UPDATE auth_codes SET attempts = ?, consumed_at = ? WHERE id = ?",
            (attempts, consumed_at, row["id"]),
        )
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    db.execute("UPDATE auth_codes SET consumed_at = ? WHERE id = ?", (now, row["id"]))
    return row


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


def authenticated_response(
    user: dict[str, Any],
    request: Request,
    response: Response,
    *,
    action: str,
    summary: str,
) -> AuthResponse:
    workspace, agent, _runtime = ensure_personal_workspace(user)
    create_session(user, request, response)
    record_audit(
        tenant_id=user["id"],
        workspace_id=workspace.id,
        agent_id=agent.id,
        actor="Verxio",
        action=action,
        summary=summary,
        status="success",
    )
    return AuthResponse(user=user_public(user), workspace=workspace, profile=agent)


def signup(payload: SignupRequest) -> AuthCodeChallengeResponse:
    email = normalize_email(payload.email)
    existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if existing and int(existing.get("email_verified") or 0) == 1:
        raise HTTPException(status_code=409, detail="An account with this email already exists.")

    created_at = now_iso()
    if existing:
        user_id = str(existing["id"])
        db.execute(
            """
            UPDATE users
            SET name = ?, password_hash = ?, email_verified = 0, updated_at = ?
            WHERE id = ?
            """,
            (payload.name.strip(), hash_password(payload.password), created_at, user_id),
        )
    else:
        user_id = new_id("user")
        db.execute(
            """
            INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
            VALUES (?, ?, ?, ?, 0, ?, ?)
            """,
            (user_id, email, payload.name.strip(), hash_password(payload.password), created_at, created_at),
        )

    record_audit(
        tenant_id=user_id,
        actor="Verxio",
        action="auth.signup_requested",
        summary="Created an unverified user and sent an email verification code.",
        status="pending",
    )
    return create_auth_code_challenge(email=email, purpose="email_verify", user_id=user_id)


def verify_email(payload: AuthCodeVerifyRequest, request: Request, response: Response) -> AuthResponse:
    code_row = consume_auth_code(payload.email, "email_verify", payload.code)
    user_id = code_row.get("user_id")
    user = (
        db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,))
        if user_id
        else db.fetch_one("SELECT * FROM users WHERE email = ?", (normalize_email(payload.email),))
    )
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    db.execute("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?", (now_iso(), user["id"]))
    verified_user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    if not verified_user:
        raise HTTPException(status_code=500, detail="Could not verify user.")

    return authenticated_response(
        verified_user,
        request,
        response,
        action="auth.email_verified",
        summary="Verified email and opened the Verxio workspace.",
    )


def resend_verification(payload: EmailRequest) -> AuthCodeChallengeResponse:
    email = normalize_email(payload.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if user and int(user.get("email_verified") or 0) == 0:
        return create_auth_code_challenge(email=email, purpose="email_verify", user_id=str(user["id"]))
    return _challenge_response(email, "email_verify")


def login(payload: LoginRequest, request: Request, response: Response) -> AuthResponse:
    email = normalize_email(payload.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user or not verify_password(payload.password, str(user["password_hash"])):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    if int(user.get("email_verified") or 0) != 1:
        create_auth_code_challenge(email=email, purpose="email_verify", user_id=str(user["id"]))
        raise HTTPException(
            status_code=403,
            detail="Verify your email before signing in. We sent a new verification code.",
        )

    return authenticated_response(
        user,
        request,
        response,
        action="auth.login",
        summary="User logged into their Verxio workspace with a password.",
    )


def request_login_code(payload: EmailRequest) -> AuthCodeChallengeResponse:
    email = normalize_email(payload.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user:
        return _challenge_response(email, "login")
    if int(user.get("email_verified") or 0) != 1:
        return create_auth_code_challenge(email=email, purpose="email_verify", user_id=str(user["id"]))
    return create_auth_code_challenge(email=email, purpose="login", user_id=str(user["id"]))


def verify_login_code(payload: AuthCodeVerifyRequest, request: Request, response: Response) -> AuthResponse:
    code_row = consume_auth_code(payload.email, "login", payload.code)
    user_id = code_row.get("user_id")
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,)) if user_id else None
    if not user or int(user.get("email_verified") or 0) != 1:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    return authenticated_response(
        user,
        request,
        response,
        action="auth.login_code",
        summary="User logged into their Verxio workspace with a one-time code.",
    )


def request_password_reset(payload: EmailRequest) -> AuthCodeChallengeResponse:
    email = normalize_email(payload.email)
    user = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
    if not user:
        return _challenge_response(email, "password_reset")
    return create_auth_code_challenge(email=email, purpose="password_reset", user_id=str(user["id"]))


def reset_password(payload: PasswordResetRequest, request: Request, response: Response) -> AuthResponse:
    code_row = consume_auth_code(payload.email, "password_reset", payload.code)
    user_id = code_row.get("user_id")
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (user_id,)) if user_id else None
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired code.")

    db.execute(
        """
        UPDATE users
        SET password_hash = ?, email_verified = 1, updated_at = ?
        WHERE id = ?
        """,
        (hash_password(payload.password), now_iso(), user["id"]),
    )
    updated = db.fetch_one("SELECT * FROM users WHERE id = ?", (user["id"],))
    if not updated:
        raise HTTPException(status_code=500, detail="Could not reset password.")

    return authenticated_response(
        updated,
        request,
        response,
        action="auth.password_reset",
        summary="User reset their password and opened the Verxio workspace.",
    )


def logout(request: Request, response: Response) -> dict[str, bool]:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        db.execute("DELETE FROM sessions WHERE token_hash = ?", (hash_session_token(token),))
    clear_session_cookie(response)
    return {"ok": True}


def me(user: dict[str, Any]) -> AuthResponse:
    workspace, agent, _runtime = ensure_personal_workspace(user)
    return AuthResponse(user=user_public(user), workspace=workspace, profile=agent)
