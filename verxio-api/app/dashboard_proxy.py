"""Per-runtime upstream limiting and short-TTL read coalescing for the
dashboard proxy.

Why not one global semaphore: every API replica used to serialise *all*
tenants' dashboard reads through ``asyncio.Semaphore(1)``. One slow Hermes
(cold boot, big ``/api/sessions``) then queued every other user's status
poll behind it — a noisy neighbour turned into "Reconnecting to Verxio" for
everyone on that replica. Hermes runs a single asyncio loop per runtime, so
the right unit of back-pressure is the runtime, not the process.

Why a read cache: the web client (and every open tab) polls ``/api/status``
and ``/api/sessions`` on timers. Under a boot flood those identical GETs
stampede the one Hermes loop. Collapsing identical in-flight reads
(single-flight) and re-serving a response for a couple of seconds keeps the
runtime loop free for the websocket without changing what the UI sees.
"""

from __future__ import annotations

import asyncio
import os
import time
from collections import OrderedDict
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.metrics import READ_CACHE as READ_CACHE_EVENTS


def _env_int(name: str, default: int, *, minimum: int = 1) -> int:
    raw = (os.getenv(name) or "").strip()
    try:
        return max(minimum, int(raw)) if raw else default
    except ValueError:
        return default


def _env_float(name: str, default: float, *, minimum: float = 0.0) -> float:
    raw = (os.getenv(name) or "").strip()
    try:
        return max(minimum, float(raw)) if raw else default
    except ValueError:
        return default


def per_runtime_concurrency() -> int:
    """Parallel upstream requests allowed per runtime (default 2: one poll +
    one user action, healthz bypasses the limiter entirely)."""
    return _env_int("VERXIO_DASHBOARD_PROXY_CONCURRENCY", 2)


class RuntimeUpstreamLimiter:
    """Lazily created ``asyncio.Semaphore`` per runtime id.

    Semaphores for runtimes that have gone quiet are evicted LRU-style once
    the table exceeds ``max_entries`` so a million-tenant control plane does
    not leak one object per tenant it has ever proxied for.
    """

    def __init__(self, *, max_entries: int = 4096) -> None:
        self._max_entries = max(16, max_entries)
        self._slots: OrderedDict[str, asyncio.Semaphore] = OrderedDict()
        self._active: dict[str, int] = {}

    def semaphore(self, runtime_id: str) -> asyncio.Semaphore:
        key = runtime_id or "-"
        sem = self._slots.get(key)
        if sem is None:
            sem = asyncio.Semaphore(per_runtime_concurrency())
            self._slots[key] = sem
            self._evict()
        else:
            self._slots.move_to_end(key)
        return sem

    def _evict(self) -> None:
        while len(self._slots) > self._max_entries:
            for key in list(self._slots):
                if self._active.get(key, 0) == 0:
                    self._slots.pop(key, None)
                    break
            else:
                return

    def slot(self, runtime_id: str) -> "_Slot":
        return _Slot(self, runtime_id or "-")

    def active(self, runtime_id: str) -> int:
        return self._active.get(runtime_id or "-", 0)

    def tracked(self) -> int:
        return len(self._slots)

    def reset_for_tests(self) -> None:
        self._slots.clear()
        self._active.clear()


class _Slot:
    def __init__(self, limiter: RuntimeUpstreamLimiter, key: str) -> None:
        self._limiter = limiter
        self._key = key
        self._sem: asyncio.Semaphore | None = None

    async def __aenter__(self) -> None:
        self._sem = self._limiter.semaphore(self._key)
        await self._sem.acquire()
        self._limiter._active[self._key] = self._limiter._active.get(self._key, 0) + 1

    async def __aexit__(self, *_exc: object) -> None:
        assert self._sem is not None
        self._sem.release()
        remaining = self._limiter._active.get(self._key, 0) - 1
        if remaining <= 0:
            self._limiter._active.pop(self._key, None)
        else:
            self._limiter._active[self._key] = remaining


@dataclass(frozen=True)
class CachedResponse:
    status_code: int
    headers: tuple[tuple[str, str], ...]
    content: bytes
    stored_at: float


# Read paths that many clients poll on timers. Anything else is passed
# straight through — writes and one-shot reads are never cached.
CACHEABLE_READ_PATHS = frozenset(
    {
        "api/status",
        "api/sessions",
        "api/config",
        "api/config/defaults",
        "api/config/schema",
        "api/env",
        "api/models",
        "api/model/info",
        "api/model/auxiliary",
        "api/providers/oauth",
    }
)


def read_cache_ttl_seconds() -> float:
    return _env_float("VERXIO_DASHBOARD_READ_CACHE_TTL_SECONDS", 2.0)


def cacheable_read(method: str, path: str) -> bool:
    return method.upper() == "GET" and path.strip("/") in CACHEABLE_READ_PATHS and read_cache_ttl_seconds() > 0


class DashboardReadCache:
    """Single-flight + short TTL cache keyed by (runtime, path, query).

    ``get_or_fetch`` runs ``fetch`` once for concurrent identical requests and
    hands every waiter the same result. Successful (<500) responses are kept
    for ``ttl`` seconds; errors are never cached so a recovering runtime is
    re-probed immediately.
    """

    def __init__(self, *, max_entries: int = 8192) -> None:
        self._max_entries = max(64, max_entries)
        self._entries: OrderedDict[tuple[str, str, str], CachedResponse] = OrderedDict()
        self._inflight: dict[tuple[str, str, str], asyncio.Future[CachedResponse]] = {}
        self.hits = 0
        self.coalesced = 0
        self.misses = 0

    @staticmethod
    def key(runtime_id: str, path: str, query: str) -> tuple[str, str, str]:
        return (runtime_id or "-", path.strip("/"), query or "")

    def peek(self, key: tuple[str, str, str], *, now: float | None = None) -> CachedResponse | None:
        entry = self._entries.get(key)
        if entry is None:
            return None
        now = time.monotonic() if now is None else now
        if now - entry.stored_at > read_cache_ttl_seconds():
            self._entries.pop(key, None)
            return None
        self._entries.move_to_end(key)
        return entry

    def invalidate_runtime(self, runtime_id: str) -> None:
        for key in [k for k in self._entries if k[0] == (runtime_id or "-")]:
            self._entries.pop(key, None)

    def reset_for_tests(self) -> None:
        self._entries.clear()
        self._inflight.clear()
        self.hits = self.coalesced = self.misses = 0

    async def get_or_fetch(
        self,
        key: tuple[str, str, str],
        fetch: Callable[[], Awaitable[CachedResponse]],
    ) -> CachedResponse:
        cached = self.peek(key)
        if cached is not None:
            self.hits += 1
            READ_CACHE_EVENTS.inc(result="hit")
            return cached
        pending = self._inflight.get(key)
        if pending is not None:
            self.coalesced += 1
            READ_CACHE_EVENTS.inc(result="coalesced")
            return await asyncio.shield(pending)
        self.misses += 1
        READ_CACHE_EVENTS.inc(result="miss")
        loop = asyncio.get_running_loop()
        future: asyncio.Future[CachedResponse] = loop.create_future()
        self._inflight[key] = future
        try:
            result = await fetch()
        except BaseException as exc:
            if not future.done():
                future.set_exception(exc)
            raise
        else:
            if not future.done():
                future.set_result(result)
            if result.status_code < 500:
                self._entries[key] = result
                self._entries.move_to_end(key)
                while len(self._entries) > self._max_entries:
                    self._entries.popitem(last=False)
            return result
        finally:
            self._inflight.pop(key, None)
            # Nobody awaited a failed future: mark retrieved so asyncio does
            # not log "exception was never retrieved".
            if future.done() and future.exception() is not None:
                future.exception()


UPSTREAM_LIMITER = RuntimeUpstreamLimiter()
READ_CACHE = DashboardReadCache()
