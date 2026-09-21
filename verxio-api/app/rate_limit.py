"""Token-bucket rate limits for auth, public, and webhook routes."""

from __future__ import annotations

import os
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.infra.redis import cache_get, cache_set

_WINDOWS: dict[str, deque[float]] = defaultdict(deque)

AUTH_PATHS = ("/api/auth/",)
PUBLIC_PATHS = ("/api/public/",)
HOOK_PATHS = ("/api/hooks/", "/api/workflow-webhooks/", "/api/composio/webhooks")


def _limit_for(path: str) -> tuple[int, float] | None:
    if any(path.startswith(prefix) for prefix in AUTH_PATHS):
        return int(os.getenv("VERXIO_RATE_LIMIT_AUTH", "5000")), 60.0
    if any(path.startswith(prefix) for prefix in HOOK_PATHS):
        return int(os.getenv("VERXIO_RATE_LIMIT_HOOKS", "120")), 60.0
    if any(path.startswith(prefix) for prefix in PUBLIC_PATHS):
        return int(os.getenv("VERXIO_RATE_LIMIT_PUBLIC", "60")), 60.0
    return None


def _client_key(request: Request, path: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    host = forwarded or (request.client.host if request.client else "unknown")
    return f"rl:{path.split('/', 3)[2] if path.startswith('/api/') else 'other'}:{host}"


def _allow(key: str, limit: int, window: float) -> bool:
    cached = cache_get(key)
    now = time.time()
    if cached is not None:
        try:
            count = int(cached)
        except ValueError:
            count = 0
        if count >= limit:
            return False
        cache_set(key, str(count + 1), ttl_seconds=window)
        return True

    hits = _WINDOWS[key]
    while hits and hits[0] <= now - window:
        hits.popleft()
    if len(hits) >= limit:
        cache_set(key, str(len(hits)), ttl_seconds=window)
        return False
    hits.append(now)
    cache_set(key, str(len(hits)), ttl_seconds=window)
    return True


class RateLimitMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        path = request.url.path
        limits = _limit_for(path)
        if limits is None:
            return await call_next(request)
        limit, window = limits
        if not _allow(_client_key(request, path), limit, window):
            return JSONResponse({"detail": "Rate limit exceeded."}, status_code=429)
        return await call_next(request)


def enforce_rate_limit(request: Request, *, limit: int, window: float = 60.0) -> None:
    if not _allow(_client_key(request, request.url.path), limit, window):
        raise HTTPException(status_code=429, detail="Rate limit exceeded.")
