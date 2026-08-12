"""Verxio Messaging webhooks — public ingress + dashboard CRUD proxy."""

from __future__ import annotations

import logging
import os
import re
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from app import db
from app.control_plane import get_runtime_for_user, runtime_from_row
from app.models import RuntimeInstance
from app.runtime_manager import (
    runtime_dashboard_base_url,
    runtime_live_dashboard_token_async,
    runtime_webhook_base_url,
)
from app.runtime_orch.lifecycle import wake_runtime

logger = logging.getLogger(__name__)

WEBHOOK_CONTAINER_PORT = 8644
_ROUTE_NAME_RE = re.compile(r"^[a-z0-9][a-z0-9_-]*$")
_NON_DELIVER_PLATFORMS = frozenset({"webhook", "api_server", "msgraph_webhook"})
_HOP_BY_HOP = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)


class MessagingWebhookCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    description: str | None = None
    events: list[str] = Field(default_factory=list)
    prompt: str | None = None
    skills: list[str] = Field(default_factory=list)
    deliver: str = Field(min_length=1, max_length=64)
    deliver_chat_id: str | None = None
    secret: str | None = None


class MessagingWebhookEnabledToggle(BaseModel):
    enabled: bool


def public_hooks_base(request: Request, workspace_id: str) -> str:
    explicit = (os.getenv("VERXIO_PUBLIC_API_URL") or "").strip().rstrip("/")
    if explicit:
        return f"{explicit}/api/hooks/{workspace_id}"
    web = (os.getenv("VERXIO_PUBLIC_WEB_URL") or "").strip().rstrip("/")
    if web:
        return f"{web}/api/hooks/{workspace_id}"
    return str(request.base_url).rstrip("/") + f"/api/hooks/{workspace_id}"


def rewrite_webhook_urls(payload: dict[str, Any], public_base: str) -> dict[str, Any]:
    rewritten = dict(payload)
    rewritten["base_url"] = public_base
    subscriptions = []
    for item in payload.get("subscriptions") or []:
        if not isinstance(item, dict):
            continue
        row = dict(item)
        name = str(row.get("name") or "").strip()
        if name:
            row["url"] = f"{public_base}/{name}"
        subscriptions.append(row)
    rewritten["subscriptions"] = subscriptions
    if isinstance(rewritten.get("url"), str) and rewritten.get("name"):
        rewritten["url"] = f"{public_base}/{rewritten['name']}"
    return rewritten


def get_runtime_for_workspace(workspace_id: str) -> RuntimeInstance:
    row = db.fetch_one(
        """
        SELECT * FROM runtime_instances
        WHERE workspace_id = ?
        ORDER BY created_at ASC
        LIMIT 1
        """,
        (workspace_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workspace runtime not found.")
    return runtime_from_row(row)


def _swap_url_port(url: str, port: int) -> str:
    parsed = urlparse(url)
    host = parsed.hostname or ""
    if not host:
        return url
    netloc = f"{host}:{port}"
    if parsed.username:
        userinfo = parsed.username
        if parsed.password:
            userinfo = f"{userinfo}:{parsed.password}"
        netloc = f"{userinfo}@{netloc}"
    return urlunparse(parsed._replace(netloc=netloc))


async def resolve_webhook_base(runtime: RuntimeInstance) -> str | None:
    from app.runtime_orch.factory import get_runtime_manager

    manager = get_runtime_manager()
    address = await manager.webhook_address(runtime)
    if address:
        return address.rstrip("/")
    fallback = runtime_webhook_base_url(runtime, ensure_network=False)
    if fallback:
        return fallback.rstrip("/")
    dashboard = runtime_dashboard_base_url(runtime, ensure_network=False)
    if dashboard:
        return _swap_url_port(dashboard, WEBHOOK_CONTAINER_PORT).rstrip("/")
    return None


def _forward_headers(request: Request) -> dict[str, str]:
    headers = {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in _HOP_BY_HOP
    }
    secret = request.headers.get("X-Verxio-Webhook-Secret") or request.query_params.get("secret") or ""
    if secret and "x-gitlab-token" not in {k.lower() for k in headers}:
        headers["X-Gitlab-Token"] = secret
    return headers


async def ingest_public_hook(workspace_id: str, route_name: str, request: Request) -> httpx.Response:
    name = (route_name or "").strip().lower()
    if not _ROUTE_NAME_RE.match(name):
        raise HTTPException(status_code=400, detail="Invalid webhook route name.")

    runtime = get_runtime_for_workspace(workspace_id)
    runtime = await wake_runtime(runtime, wait_ready=True, reason="messaging.webhook")
    base = await resolve_webhook_base(runtime)
    if not base:
        raise HTTPException(
            status_code=503,
            detail="Runtime webhook listener is starting. Retry shortly.",
        )

    body = await request.body()
    target = f"{base}/webhooks/{name}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=10.0)) as client:
            return await client.post(target, content=body, headers=_forward_headers(request))
    except httpx.RequestError as exc:
        logger.warning("Messaging webhook forward failed workspace=%s route=%s err=%s", workspace_id, name, exc)
        raise HTTPException(
            status_code=503,
            detail="Runtime webhook listener is starting. Retry shortly.",
        ) from exc


async def _dashboard_token(runtime: RuntimeInstance) -> str:
    row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime.id,))
    fallback = str(row.get("dashboard_token") or "") if row else ""
    token = await runtime_live_dashboard_token_async(runtime, fallback=fallback)
    if not token:
        token = fallback
    if not token:
        raise HTTPException(status_code=503, detail="Runtime dashboard token is not ready.")
    return token


def _dashboard_auth_headers(token: str) -> dict[str, str]:
    return {
        "X-Hermes-Session-Token": token,
        "Authorization": f"Bearer {token}",
        "Accept": "application/json",
    }


async def _dashboard_request(
    runtime: RuntimeInstance,
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
) -> httpx.Response:
    runtime = await wake_runtime(runtime, wait_ready=False, reason="messaging.webhooks")
    base = runtime_dashboard_base_url(runtime, ensure_network=False)
    if not base:
        raise HTTPException(status_code=503, detail="Runtime dashboard is starting. Retry shortly.")
    token = await _dashboard_token(runtime)
    url = f"{base.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(30.0, connect=5.0)) as client:
            return await client.request(
                method,
                url,
                headers=_dashboard_auth_headers(token),
                json=json_body,
            )
    except httpx.RequestError as exc:
        logger.warning("Messaging webhook dashboard proxy failed path=%s err=%s", path, exc)
        raise HTTPException(
            status_code=503,
            detail="Runtime dashboard is starting. Retry shortly.",
        ) from exc


def _raise_for_upstream(resp: httpx.Response) -> None:
    if resp.status_code < 400:
        return
    detail: Any
    try:
        payload = resp.json()
        detail = payload.get("detail") or payload.get("error") or payload
    except Exception:
        detail = resp.text or f"Runtime returned {resp.status_code}."
    raise HTTPException(status_code=resp.status_code, detail=detail)


async def _load_messaging_platforms(runtime: RuntimeInstance) -> list[dict[str, Any]]:
    resp = await _dashboard_request(runtime, "GET", "/api/messaging/platforms")
    if resp.status_code >= 400:
        return []
    try:
        payload = resp.json()
    except Exception:
        return []
    platforms = payload.get("platforms") if isinstance(payload, dict) else None
    return platforms if isinstance(platforms, list) else []


def _platform_connected(platform: dict[str, Any]) -> bool:
    state = str(platform.get("state") or "").strip().lower()
    return state == "connected" or bool(platform.get("configured") and platform.get("enabled"))


def _home_chat_id(platform: dict[str, Any]) -> str:
    home = platform.get("home_channel")
    if isinstance(home, dict):
        return str(home.get("chat_id") or "").strip()
    return ""


async def assert_deliver_target(runtime: RuntimeInstance, deliver: str, deliver_chat_id: str | None) -> str:
    target = (deliver or "").strip().lower()
    if not target or target == "log" or target in _NON_DELIVER_PLATFORMS:
        raise HTTPException(
            status_code=400,
            detail="Choose a connected messaging channel to deliver replies.",
        )
    platforms = await _load_messaging_platforms(runtime)
    platform = next((row for row in platforms if str(row.get("id") or "") == target), None)
    if not platform or not _platform_connected(platform):
        raise HTTPException(
            status_code=400,
            detail=f"No connection for {target}. Connect it in Messaging first.",
        )
    home_id = _home_chat_id(platform)
    chat_id = (deliver_chat_id or "").strip() or home_id
    if not chat_id:
        raise HTTPException(
            status_code=400,
            detail=f"Set a home channel for {target} in Messaging before delivering webhooks there.",
        )
    return chat_id


async def list_webhooks(request: Request, user: dict[str, Any]) -> dict[str, Any]:
    workspace_id = str(get_runtime_for_user(user).workspace_id)
    runtime = get_runtime_for_user(user)
    resp = await _dashboard_request(runtime, "GET", "/api/webhooks")
    _raise_for_upstream(resp)
    try:
        payload = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Invalid webhook list from runtime.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=502, detail="Invalid webhook list from runtime.")
    return rewrite_webhook_urls(payload, public_hooks_base(request, workspace_id))


async def enable_webhooks(user: dict[str, Any]) -> dict[str, Any]:
    runtime = get_runtime_for_user(user)
    resp = await _dashboard_request(runtime, "POST", "/api/webhooks/enable")
    _raise_for_upstream(resp)
    try:
        payload = resp.json()
    except Exception:
        payload = {"ok": True, "enabled": True}
    if not isinstance(payload, dict):
        payload = {"ok": True, "enabled": True}
    payload.setdefault("ok", True)
    payload["enabled"] = True
    return payload


async def create_webhook(request: Request, user: dict[str, Any], body: MessagingWebhookCreate) -> dict[str, Any]:
    name = body.name.strip().lower().replace(" ", "-")
    if not _ROUTE_NAME_RE.match(name):
        raise HTTPException(
            status_code=400,
            detail="Invalid name. Use lowercase letters, digits, hyphens, or underscores.",
        )
    runtime = get_runtime_for_user(user)
    chat_id = await assert_deliver_target(runtime, body.deliver, body.deliver_chat_id)
    payload = {
        "name": name,
        "description": body.description or "",
        "events": [item.strip() for item in body.events if item.strip()],
        "prompt": body.prompt or "",
        "skills": [item.strip() for item in body.skills if item.strip()],
        "deliver": body.deliver.strip().lower(),
        "deliver_chat_id": chat_id,
    }
    if body.secret:
        payload["secret"] = body.secret
    resp = await _dashboard_request(runtime, "POST", "/api/webhooks", json_body=payload)
    _raise_for_upstream(resp)
    try:
        created = resp.json()
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Invalid webhook create response.") from exc
    if not isinstance(created, dict):
        raise HTTPException(status_code=502, detail="Invalid webhook create response.")
    public_base = public_hooks_base(request, str(runtime.workspace_id))
    return rewrite_webhook_urls(created, public_base)


async def delete_webhook(user: dict[str, Any], name: str) -> dict[str, Any]:
    runtime = get_runtime_for_user(user)
    key = name.strip().lower()
    resp = await _dashboard_request(runtime, "DELETE", f"/api/webhooks/{key}")
    _raise_for_upstream(resp)
    return {"ok": True}


async def set_webhook_enabled(user: dict[str, Any], name: str, enabled: bool) -> dict[str, Any]:
    runtime = get_runtime_for_user(user)
    key = name.strip().lower()
    resp = await _dashboard_request(
        runtime,
        "PUT",
        f"/api/webhooks/{key}/enabled",
        json_body={"enabled": enabled},
    )
    _raise_for_upstream(resp)
    return {"ok": True, "name": key, "enabled": enabled}
