"""Redis streams, leases, pub/sub, and cache.

Falls back to in-process structures when ``VERXIO_REDIS_URL`` is unset so
local tests and single-node Docker keep working.
"""

from __future__ import annotations

import json
import logging
import os
import socket
import threading
import time
import uuid
from collections import defaultdict, deque
from typing import Any, AsyncIterator, Callable

logger = logging.getLogger(__name__)

STREAM_TURNS = "verxio:turns"
STREAM_DELIVER = "verxio:deliver"
STREAM_WEBHOOKS = "verxio:webhooks"
STREAM_WAKE = "verxio:wake"
STREAM_ATTACH = "verxio:attach"
GROUP_WORKERS = "verxio-workers"
GROUP_SCHEDULER = "verxio-scheduler"
GROUP_CHANNELS = "verxio-channels"

_MEMORY_LOCK = threading.Lock()
_MEMORY_STREAMS: dict[str, deque[tuple[str, dict[str, str]]]] = defaultdict(deque)
_MEMORY_LEASES: dict[str, tuple[str, float]] = {}
_MEMORY_CACHE: dict[str, tuple[float, str]] = {}
_MEMORY_SUBS: dict[str, list[Callable[[str], None]]] = defaultdict(list)
_CLIENT = None
_CLIENT_FAILED = False


class RedisUnavailable(RuntimeError):
    pass


def redis_url() -> str:
    return os.getenv("VERXIO_REDIS_URL", "").strip()


def worker_id() -> str:
    explicit = os.getenv("VERXIO_WORKER_ID", "").strip()
    if explicit:
        return explicit
    return f"{socket.gethostname()}:{os.getpid()}"


def get_redis():
    """Return a redis-py client or None when Redis is not configured/reachable."""
    global _CLIENT, _CLIENT_FAILED
    url = redis_url()
    if not url or _CLIENT_FAILED:
        return _CLIENT if url and not _CLIENT_FAILED else None
    if _CLIENT is not None:
        return _CLIENT
    try:
        import redis  # type: ignore[import-untyped]

        _CLIENT = redis.Redis.from_url(url, decode_responses=True)
        _CLIENT.ping()
        return _CLIENT
    except Exception:
        logger.warning("Redis unavailable at %s; using in-process fallback", url, exc_info=True)
        _CLIENT_FAILED = True
        _CLIENT = None
        return None


def _ensure_group(client, stream: str, group: str) -> None:
    try:
        client.xgroup_create(stream, group, id="0", mkstream=True)
    except Exception as exc:
        if "BUSYGROUP" not in str(exc):
            raise


def enqueue(stream: str, fields: dict[str, Any], *, maxlen: int = 50_000) -> str:
    payload = {key: _stringify(value) for key, value in fields.items()}
    client = get_redis()
    if client is not None:
        message_id = client.xadd(stream, payload, maxlen=maxlen, approximate=True)
        return str(message_id)
    message_id = f"{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
    with _MEMORY_LOCK:
        _MEMORY_STREAMS[stream].append((message_id, payload))
        while len(_MEMORY_STREAMS[stream]) > maxlen:
            _MEMORY_STREAMS[stream].popleft()
    return message_id


def read_group(
    stream: str,
    group: str,
    consumer: str,
    *,
    count: int = 8,
    block_ms: int = 2000,
) -> list[tuple[str, dict[str, str]]]:
    client = get_redis()
    if client is not None:
        _ensure_group(client, stream, group)
        rows = client.xreadgroup(group, consumer, {stream: ">"}, count=count, block=block_ms) or []
        out: list[tuple[str, dict[str, str]]] = []
        for _name, messages in rows:
            for message_id, fields in messages:
                out.append((str(message_id), {str(k): str(v) for k, v in fields.items()}))
        return out
    deadline = time.time() + (block_ms / 1000)
    while time.time() < deadline:
        with _MEMORY_LOCK:
            if _MEMORY_STREAMS[stream]:
                return [_MEMORY_STREAMS[stream].popleft()]
        time.sleep(0.05)
    return []


def xack(stream: str, group: str, message_id: str) -> None:
    client = get_redis()
    if client is None:
        return
    try:
        client.xack(stream, group, message_id)
    except Exception:
        logger.debug("xack failed stream=%s id=%s", stream, message_id, exc_info=True)


def try_acquire_lease(key: str, *, ttl_seconds: float = 90.0, token: str | None = None) -> str | None:
    token = token or uuid.uuid4().hex
    client = get_redis()
    if client is not None:
        ok = client.set(f"verxio:lease:{key}", token, nx=True, ex=max(1, int(ttl_seconds)))
        return token if ok else None
    now = time.monotonic()
    with _MEMORY_LOCK:
        existing = _MEMORY_LEASES.get(key)
        if existing and existing[1] > now:
            return None
        _MEMORY_LEASES[key] = (token, now + ttl_seconds)
        return token


def heartbeat_lease(key: str, token: str, *, ttl_seconds: float = 90.0) -> bool:
    client = get_redis()
    if client is not None:
        current = client.get(f"verxio:lease:{key}")
        if current != token:
            return False
        client.expire(f"verxio:lease:{key}", max(1, int(ttl_seconds)))
        return True
    now = time.monotonic()
    with _MEMORY_LOCK:
        existing = _MEMORY_LEASES.get(key)
        if not existing or existing[0] != token:
            return False
        _MEMORY_LEASES[key] = (token, now + ttl_seconds)
        return True


def release_lease(key: str, token: str) -> None:
    client = get_redis()
    if client is not None:
        pipe_key = f"verxio:lease:{key}"
        current = client.get(pipe_key)
        if current == token:
            client.delete(pipe_key)
        return
    with _MEMORY_LOCK:
        existing = _MEMORY_LEASES.get(key)
        if existing and existing[0] == token:
            _MEMORY_LEASES.pop(key, None)


def cache_get(key: str) -> str | None:
    client = get_redis()
    if client is not None:
        value = client.get(f"verxio:cache:{key}")
        return str(value) if value is not None else None
    now = time.monotonic()
    with _MEMORY_LOCK:
        item = _MEMORY_CACHE.get(key)
        if not item:
            return None
        expires_at, value = item
        if expires_at <= now:
            _MEMORY_CACHE.pop(key, None)
            return None
        return value


def cache_set(key: str, value: str, *, ttl_seconds: float = 30.0) -> None:
    client = get_redis()
    if client is not None:
        client.set(f"verxio:cache:{key}", value, ex=max(1, int(ttl_seconds)))
        return
    with _MEMORY_LOCK:
        _MEMORY_CACHE[key] = (time.monotonic() + ttl_seconds, value)


def cache_delete(key: str) -> None:
    client = get_redis()
    if client is not None:
        client.delete(f"verxio:cache:{key}")
        return
    with _MEMORY_LOCK:
        _MEMORY_CACHE.pop(key, None)


def publish(channel: str, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, separators=(",", ":"))
    client = get_redis()
    if client is not None:
        client.publish(channel, body)
        return
    with _MEMORY_LOCK:
        listeners = list(_MEMORY_SUBS.get(channel, []))
    for listener in listeners:
        try:
            listener(body)
        except Exception:
            logger.debug("in-process subscriber failed", exc_info=True)


async def subscribe(channel: str) -> AsyncIterator[dict[str, Any]]:
    import asyncio

    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    client = get_redis()
    if client is not None:

        def _listen() -> None:
            pubsub = client.pubsub(ignore_subscribe_messages=True)
            pubsub.subscribe(channel)
            for message in pubsub.listen():
                if message.get("type") != "message":
                    continue
                data = message.get("data")
                try:
                    queue.put_nowait(json.loads(data) if isinstance(data, str) else {})
                except Exception:
                    continue

        thread = threading.Thread(target=_listen, name=f"redis-sub-{channel}", daemon=True)
        thread.start()
    else:

        def _listener(body: str) -> None:
            try:
                queue.put_nowait(json.loads(body))
            except Exception:
                return

        with _MEMORY_LOCK:
            _MEMORY_SUBS[channel].append(_listener)

    while True:
        yield await queue.get()


def lookup_holder(key: str) -> str | None:
    """Return the token currently holding ``key`` (worker id when we store it as the token)."""
    client = get_redis()
    if client is not None:
        value = client.get(f"verxio:lease:{key}")
        return str(value) if value else None
    with _MEMORY_LOCK:
        existing = _MEMORY_LEASES.get(key)
        if not existing:
            return None
        token, expires_at = existing
        if expires_at <= time.monotonic():
            return None
        return token


def _stringify(value: Any) -> str:
    if isinstance(value, str):
        return value
    if value is None:
        return ""
    if isinstance(value, (int, float, bool)):
        return str(value)
    return json.dumps(value, separators=(",", ":"))
