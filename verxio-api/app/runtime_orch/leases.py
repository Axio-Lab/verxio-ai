"""Distributed start leases (Phase 3). Redis when configured; in-process fallback."""

from __future__ import annotations

import os
import threading
import time
import uuid
from dataclasses import dataclass


@dataclass
class Lease:
    key: str
    token: str
    expires_at: float


class LeaseStore:
    def try_acquire(self, key: str, *, ttl_seconds: float = 90.0) -> Lease | None: ...

    def release(self, lease: Lease) -> None: ...


class InMemoryLeaseStore(LeaseStore):
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._leases: dict[str, Lease] = {}

    def try_acquire(self, key: str, *, ttl_seconds: float = 90.0) -> Lease | None:
        now = time.monotonic()
        with self._lock:
            existing = self._leases.get(key)
            if existing and existing.expires_at > now:
                return None
            lease = Lease(key=key, token=uuid.uuid4().hex, expires_at=now + ttl_seconds)
            self._leases[key] = lease
            return lease

    def release(self, lease: Lease) -> None:
        with self._lock:
            current = self._leases.get(lease.key)
            if current and current.token == lease.token:
                del self._leases[lease.key]


class RedisLeaseStore(LeaseStore):
    """Minimal Redis SET NX lease. Requires redis package at runtime."""

    def __init__(self, url: str) -> None:
        import redis  # type: ignore[import-untyped]

        self._client = redis.Redis.from_url(url, decode_responses=True)

    def try_acquire(self, key: str, *, ttl_seconds: float = 90.0) -> Lease | None:
        token = uuid.uuid4().hex
        ok = self._client.set(f"verxio:lease:{key}", token, nx=True, ex=max(1, int(ttl_seconds)))
        if not ok:
            return None
        return Lease(key=key, token=token, expires_at=time.monotonic() + ttl_seconds)

    def release(self, lease: Lease) -> None:
        pipe_key = f"verxio:lease:{lease.key}"
        # Compare-and-delete via Lua would be ideal; GET+DEL is acceptable for MVP.
        current = self._client.get(pipe_key)
        if current == lease.token:
            self._client.delete(pipe_key)


_STORE: LeaseStore | None = None


def get_lease_store() -> LeaseStore:
    global _STORE
    if _STORE is not None:
        return _STORE
    url = os.getenv("VERXIO_REDIS_URL", "").strip()
    if url:
        try:
            _STORE = RedisLeaseStore(url)
            return _STORE
        except Exception:
            # Fall back so control plane still boots without Redis.
            pass
    _STORE = InMemoryLeaseStore()
    return _STORE


def reset_lease_store_for_tests() -> None:
    global _STORE
    _STORE = None
