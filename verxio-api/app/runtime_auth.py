"""Authenticate Verxio control-plane requests from a hosted Hermes runtime.

Browser clients continue to use the ``verxio_session`` cookie. Agent containers
authenticate with ``Authorization: Bearer <dashboard_token>`` — the same secret
already injected as ``HERMES_DASHBOARD_SESSION_TOKEN`` / ``VERXIO_RUNTIME_TOKEN``.
"""

from __future__ import annotations

from typing import Any

from fastapi import HTTPException, Request

from app import db
from app.auth import get_current_user
from app.control_plane import (
    agent_from_row,
    get_context_for_user,
    runtime_from_row,
    workspace_from_row,
)
from app.models import AgentProfile, RuntimeInstance, Workspace


def bearer_token(request: Request) -> str | None:
    auth = (request.headers.get("Authorization") or "").strip()
    if not auth.lower().startswith("bearer "):
        return None
    token = auth[7:].strip()
    return token or None


def get_context_for_runtime_token(
    token: str,
) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
    row = db.fetch_one(
        """
        SELECT * FROM runtime_instances
        WHERE dashboard_token = ?
        LIMIT 1
        """,
        (token,),
    )
    if not row:
        raise HTTPException(status_code=401, detail="Invalid runtime token.")

    runtime = runtime_from_row(row)
    workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (runtime.workspace_id,))
    agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (runtime.agent_id,))
    if not workspace_row or not agent_row:
        raise HTTPException(status_code=401, detail="Runtime workspace is unavailable.")

    return workspace_from_row(workspace_row), agent_from_row(agent_row), runtime


def get_context_for_request(
    request: Request,
) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
    """Resolve notepad/control-plane context from cookie session or runtime bearer."""
    user = get_current_user(request)
    if user:
        return get_context_for_user(user)

    token = bearer_token(request)
    if token:
        return get_context_for_runtime_token(token)

    raise HTTPException(status_code=401, detail="Authentication required")


def require_user_or_runtime(request: Request) -> dict[str, Any] | None:
    """Return the cookie user when present; otherwise validate runtime bearer.

    Useful for routes that only need auth presence, not the user row.
    """
    user = get_current_user(request)
    if user:
        return user
    token = bearer_token(request)
    if token:
        get_context_for_runtime_token(token)
        return None
    raise HTTPException(status_code=401, detail="Authentication required")
