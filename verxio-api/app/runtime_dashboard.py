from __future__ import annotations

import logging
import os

import httpx
from fastapi import HTTPException

from app import db
from app.control_plane import ensure_runtime_instance
from app.models import AgentProfile, RuntimeInstance, Workspace
from app.runtime_manager import runtime_health, start_runtime

logger = logging.getLogger(__name__)


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


async def soft_reload_runtime_mcp(runtime: RuntimeInstance) -> dict[str, object]:
    """Ask the live Hermes dashboard to reload MCP servers from config.yaml.

    This keeps the Verxio UI connected — no Docker container restart.
    """
    if not runtime.dashboard_url:
        return {"ok": False, "message": "Runtime dashboard is not ready."}

    connected, detail = await runtime_health(runtime)
    if not connected:
        return {"ok": False, "message": detail}

    token = _runtime_dashboard_token(runtime.id)
    target = f"{runtime.dashboard_url.rstrip('/')}/api/mcp/reload"

    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(target, headers=_dashboard_headers(token))
            response.raise_for_status()
            payload = response.json()
    except httpx.HTTPStatusError as exc:
        message = exc.response.text.strip() or exc.response.reason_phrase
        try:
            parsed = exc.response.json()
            if isinstance(parsed, dict):
                message = str(parsed.get("detail") or parsed.get("message") or message)
        except ValueError:
            pass
        logger.warning("Soft MCP reload failed for %s: %s", runtime.id, message)
        return {"ok": False, "message": message or "MCP reload failed."}
    except httpx.RequestError as exc:
        logger.warning("Soft MCP reload unreachable for %s: %s", runtime.id, exc)
        return {"ok": False, "message": f"Runtime dashboard is not reachable: {exc}"}

    if not isinstance(payload, dict):
        return {"ok": True, "message": "MCP servers reloaded."}

    return {
        "ok": bool(payload.get("ok", True)),
        "message": str(payload.get("message") or "MCP servers reloaded."),
        "toolCount": payload.get("toolCount"),
    }


async def list_toolsets_via_dashboard(workspace: Workspace, profile: AgentProfile) -> list[dict[str, object]]:
    runtime = ensure_runtime_instance(workspace, profile)
    runtime = await start_runtime(runtime)

    if not runtime.dashboard_url:
        raise HTTPException(status_code=503, detail="Runtime dashboard is not ready.")

    token = _runtime_dashboard_token(runtime.id)
    target = f"{runtime.dashboard_url.rstrip('/')}/api/tools/toolsets"

    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(target, headers=_dashboard_headers(token))
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

    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        items = payload.get("toolsets")
        if isinstance(items, list):
            return [item for item in items if isinstance(item, dict)]
    return []


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


async def send_message_via_dashboard(
    workspace: Workspace,
    profile: AgentProfile,
    *,
    platform: str,
    connection_id: str,
    destination: str,
    message: str,
) -> dict[str, object]:
    runtime = ensure_runtime_instance(workspace, profile)
    runtime = await start_runtime(runtime)
    if not runtime.dashboard_url:
        raise HTTPException(status_code=503, detail="Runtime dashboard is not ready.")

    token = _runtime_dashboard_token(runtime.id)
    target = f"{runtime.dashboard_url.rstrip('/')}/api/messaging/send"
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            response = await client.post(
                target,
                json={
                    "platform": platform,
                    "connection_id": connection_id or "default",
                    "destination": destination,
                    "message": message,
                },
                headers=_dashboard_headers(token),
            )
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
        raise HTTPException(status_code=502, detail=detail or "Messaging delivery failed.") from exc
    except httpx.RequestError as exc:
        raise HTTPException(status_code=502, detail=f"Runtime dashboard is not reachable: {exc}") from exc

    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Messaging gateway returned an invalid response.")
    return payload
