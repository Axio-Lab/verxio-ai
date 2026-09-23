"""Per-runtime upstream limiter + single-flight read cache for the dashboard proxy."""

from __future__ import annotations

import asyncio

import pytest

from app import dashboard_proxy
from app.dashboard_proxy import CachedResponse, DashboardReadCache, RuntimeUpstreamLimiter, cacheable_read


@pytest.fixture(autouse=True)
def _defaults(monkeypatch):
    monkeypatch.delenv("VERXIO_DASHBOARD_PROXY_CONCURRENCY", raising=False)
    monkeypatch.delenv("VERXIO_DASHBOARD_READ_CACHE_TTL_SECONDS", raising=False)


def _resp(status: int = 200, body: bytes = b"{}") -> CachedResponse:
    import time

    return CachedResponse(status_code=status, headers=(("content-type", "application/json"),), content=body, stored_at=time.monotonic())


def test_limiter_isolates_runtimes(monkeypatch):
    monkeypatch.setenv("VERXIO_DASHBOARD_PROXY_CONCURRENCY", "1")
    limiter = RuntimeUpstreamLimiter()
    order: list[str] = []

    async def hold(runtime_id: str, label: str, release: asyncio.Event):
        async with limiter.slot(runtime_id):
            order.append(f"enter:{label}")
            await release.wait()
            order.append(f"exit:{label}")

    async def run():
        gate_a = asyncio.Event()
        gate_b = asyncio.Event()
        slow_a = asyncio.create_task(hold("rt_a", "a1", gate_a))
        await asyncio.sleep(0)
        # Same runtime: must queue behind a1.
        queued_a = asyncio.create_task(hold("rt_a", "a2", gate_a))
        # Different runtime: must NOT wait for rt_a.
        other_b = asyncio.create_task(hold("rt_b", "b1", gate_b))
        await asyncio.sleep(0.01)
        assert "enter:b1" in order
        assert "enter:a2" not in order
        assert limiter.active("rt_a") == 1 and limiter.active("rt_b") == 1
        gate_b.set()
        gate_a.set()
        await asyncio.gather(slow_a, queued_a, other_b)
        assert limiter.active("rt_a") == 0

    asyncio.run(run())


def test_limiter_evicts_idle_semaphores():
    limiter = RuntimeUpstreamLimiter(max_entries=16)
    for i in range(40):
        limiter.semaphore(f"rt_{i}")
    assert limiter.tracked() <= 16


def test_cacheable_read_only_for_polled_gets(monkeypatch):
    assert cacheable_read("GET", "api/status")
    assert cacheable_read("GET", "/api/sessions/")
    assert not cacheable_read("POST", "api/sessions")
    assert not cacheable_read("GET", "api/healthz")
    assert not cacheable_read("GET", "api/sessions/abc/messages")
    monkeypatch.setenv("VERXIO_DASHBOARD_READ_CACHE_TTL_SECONDS", "0")
    assert not cacheable_read("GET", "api/status")


def test_read_cache_single_flights_concurrent_polls():
    cache = DashboardReadCache()
    calls = {"n": 0}
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch() -> CachedResponse:
        calls["n"] += 1
        started.set()
        await release.wait()
        return _resp(body=b'{"ok":1}')

    async def run():
        key = cache.key("rt_1", "api/status", "")
        first = asyncio.create_task(cache.get_or_fetch(key, fetch))
        await started.wait()
        others = [asyncio.create_task(cache.get_or_fetch(key, fetch)) for _ in range(9)]
        await asyncio.sleep(0)
        release.set()
        results = await asyncio.gather(first, *others)
        assert calls["n"] == 1
        assert all(r.content == b'{"ok":1}' for r in results)
        assert cache.coalesced == 9
        # Within the TTL a fresh call is a hit, not a new upstream request.
        again = await cache.get_or_fetch(key, fetch)
        assert again.content == b'{"ok":1}' and calls["n"] == 1 and cache.hits == 1

    asyncio.run(run())


def test_read_cache_never_stores_errors_and_expires(monkeypatch):
    cache = DashboardReadCache()
    calls = {"n": 0}

    async def failing() -> CachedResponse:
        calls["n"] += 1
        return _resp(status=503)

    async def ok() -> CachedResponse:
        calls["n"] += 1
        return _resp(status=200)

    async def run():
        key = cache.key("rt_1", "api/sessions", "limit=20")
        assert (await cache.get_or_fetch(key, failing)).status_code == 503
        assert (await cache.get_or_fetch(key, failing)).status_code == 503
        assert calls["n"] == 2, "5xx must never be served from cache"
        assert (await cache.get_or_fetch(key, ok)).status_code == 200
        assert (await cache.get_or_fetch(key, ok)).status_code == 200
        assert calls["n"] == 3
        assert cache.peek(key) is not None
        assert cache.peek(key, now=dashboard_proxy.time.monotonic() + 60) is None, "entries expire after the TTL"
        cache.invalidate_runtime("rt_1")

    asyncio.run(run())


def test_read_cache_propagates_fetch_errors_to_all_waiters():
    cache = DashboardReadCache()
    started = asyncio.Event()

    async def boom() -> CachedResponse:
        started.set()
        await asyncio.sleep(0)
        raise RuntimeError("upstream down")

    async def run():
        key = cache.key("rt_2", "api/status", "")
        first = asyncio.create_task(cache.get_or_fetch(key, boom))
        await started.wait()
        second = asyncio.create_task(cache.get_or_fetch(key, boom))
        results = await asyncio.gather(first, second, return_exceptions=True)
        assert all(isinstance(r, RuntimeError) for r in results)
        assert key not in cache._inflight

    asyncio.run(run())
