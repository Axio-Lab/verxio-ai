from __future__ import annotations

import os

import httpx
from fastapi import HTTPException

from app import db
from app.control_plane import ensure_runtime_instance
from app.models import AgentProfile, Workspace
from app.runtime_manager import start_runtime


def _dashboard_timeout_seconds() -> float:
    try:
        return float(os.getenv("VERXIO_HERMES_TIMEOUT_SECONDS", "180"))
    except ValueError:
        return 180.0


def _runtime_dashboard_token(runtime_id: str) -> str:
    row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime_id,))
    token = str(row.get("dashboard_token") or "") if row else ""
    if not token:
        raise HTTPException(status_code=503, detail="Runtime dashboard token is not ready.")
    return token


def _dashboard_headers(token: str) -> dict[str, str]:
    return {
        "Accept": "application/json",
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "X-Hermes-Session-Token": token,
    }


async def run_agent_via_dashboard(
    workspace: Workspace,
    profile: AgentProfile,
    user_input: str,
    *,
    instructions: str | None = None,
) -> str:
    runtime = ensure_runtime_instance(workspace, profile)
    runtime = await start_runtime(runtime)

    if not runtime.dashboard_url:
        raise HTTPException(status_code=503, detail="Runtime dashboard is not ready.")

    token = _runtime_dashboard_token(runtime.id)
    body: dict[str, str] = {"input": user_input}
    if instructions:
        body["instructions"] = instructions

    timeout = _dashboard_timeout_seconds()
    target = f"{runtime.dashboard_url.rstrip('/')}/api/agent/oneshot"

    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            response = await client.post(target, json=body, headers=_dashboard_headers(token))
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        detail = exc.response.text.strip() or exc.response.reason_phrase
        try:
            parsed = exc.response.json()
            if isinstance(parsed, dict):
                detail = str(parsed.get("detail") or parsed.get("error") or detail)
        except ValueError:
            pass
        raise HTTPException(status_code=502, detail=detail or "Hermes dashboard request failed.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Runtime dashboard is not reachable: {exc}") from exc

    output = str(payload.get("output") or "").strip()
    if not output:
        raise HTTPException(status_code=502, detail="Hermes returned an empty summary.")

    return output
