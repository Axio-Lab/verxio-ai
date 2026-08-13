"""Public OpenAI-compatible proxy into a workspace runtime API server."""

from __future__ import annotations

import logging
import os
from typing import Any
from urllib.parse import urlparse, urlunparse

import httpx
from fastapi import HTTPException, Request
from starlette.responses import Response, StreamingResponse

from app.control_plane import get_runtime_for_user
from app.messaging_webhooks import (
    _HOP_BY_HOP,
    _load_messaging_platforms,
    get_runtime_for_workspace,
)
from app.models import RuntimeInstance
from app.runtime_manager import runtime_api_server_base_url, runtime_dashboard_base_url
from app.runtime_orch.lifecycle import wake_runtime

logger = logging.getLogger(__name__)

API_SERVER_CONTAINER_PORT = 8642
_EXCLUDED_RESPONSE_HEADERS = frozenset(
    {
        "content-encoding",
        "content-length",
        "transfer-encoding",
        "connection",
    }
)


def public_openai_base(request: Request, workspace_id: str) -> str:
    explicit = (os.getenv("VERXIO_PUBLIC_API_URL") or "").strip().rstrip("/")
    if explicit:
        return f"{explicit}/api/openai/{workspace_id}/v1"
    web = (os.getenv("VERXIO_PUBLIC_WEB_URL") or "").strip().rstrip("/")
    if web:
        return f"{web}/api/openai/{workspace_id}/v1"
    return str(request.base_url).rstrip("/") + f"/api/openai/{workspace_id}/v1"


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


async def resolve_api_server_base(runtime: RuntimeInstance) -> str | None:
    from app.runtime_orch.factory import get_runtime_manager

    manager = get_runtime_manager()
    address = await manager.api_server_address(runtime)
    if address:
        return address.rstrip("/")
    fallback = runtime_api_server_base_url(runtime, ensure_network=False)
    if fallback:
        return fallback.rstrip("/")
    dashboard = runtime_dashboard_base_url(runtime, ensure_network=False)
    if dashboard:
        return _swap_url_port(dashboard, API_SERVER_CONTAINER_PORT).rstrip("/")
    return None


def _forward_headers(request: Request) -> dict[str, str]:
    return {
        key: value
        for key, value in request.headers.items()
        if key.lower() not in _HOP_BY_HOP
    }


def _cors_headers() -> dict[str, str]:
    return {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type",
        "Access-Control-Max-Age": "86400",
    }


def _example_curl(base_url: str) -> str:
    return (
        f"curl {base_url}/chat/completions \\\n"
        '  -H "Authorization: Bearer $API_SERVER_KEY" \\\n'
        '  -H "Content-Type: application/json" \\\n'
        '  -d \'{"model":"verxio","messages":[{"role":"user","content":"Hello"}]}\''
    )


async def get_api_server_info(request: Request, user: dict[str, Any]) -> dict[str, Any]:
    runtime = get_runtime_for_user(user)
    workspace_id = str(runtime.workspace_id)
    base_url = public_openai_base(request, workspace_id)
    enabled = False
    model = ""
    try:
        platforms = await _load_messaging_platforms(runtime)
        platform = next((row for row in platforms if str(row.get("id") or "") == "api_server"), None)
        if isinstance(platform, dict):
            enabled = bool(platform.get("enabled"))
            for field in platform.get("env_vars") or []:
                if isinstance(field, dict) and field.get("key") == "API_SERVER_MODEL_NAME":
                    model = str(field.get("current_value") or "").strip()
                    break
    except Exception:
        logger.debug("Could not load api_server platform state", exc_info=True)
    return {
        "enabled": enabled,
        "base_url": base_url,
        "model": model or "verxio",
        "example": _example_curl(base_url),
    }


async def proxy_openai_path(workspace_id: str, path: str, request: Request) -> Response:
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=_cors_headers())

    target_path = (path or "").lstrip("/")
    if not target_path:
        raise HTTPException(status_code=404, detail="Missing OpenAI API path.")

    runtime = get_runtime_for_workspace(workspace_id)
    runtime = await wake_runtime(runtime, wait_ready=True, reason="messaging.api_server")
    base = await resolve_api_server_base(runtime)
    if not base:
        raise HTTPException(
            status_code=503,
            detail="Runtime API server is starting. Retry shortly.",
        )

    body = await request.body()
    target = f"{base}/{target_path}"
    client = httpx.AsyncClient(timeout=httpx.Timeout(300.0, connect=10.0))
    try:
        upstream_req = client.build_request(
            request.method,
            target,
            content=body,
            headers=_forward_headers(request),
            params=request.query_params,
        )
        upstream = await client.send(upstream_req, stream=True)
    except httpx.RequestError as exc:
        await client.aclose()
        logger.warning("Messaging API server forward failed workspace=%s path=%s err=%s", workspace_id, path, exc)
        raise HTTPException(
            status_code=503,
            detail="Runtime API server is starting. Retry shortly.",
        ) from exc

    headers = {
        key: value
        for key, value in upstream.headers.items()
        if key.lower() not in _EXCLUDED_RESPONSE_HEADERS
    }
    headers.update(_cors_headers())

    async def _stream():
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        _stream(),
        status_code=upstream.status_code,
        headers=headers,
        media_type=upstream.headers.get("content-type"),
    )
