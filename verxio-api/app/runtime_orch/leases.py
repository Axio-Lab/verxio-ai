"""Distributed start leases (Phase 3). Redis when configured; SQLite/Turso otherwise."""

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
    """Single-process only — prefer SqliteLeaseStore or Redis in production."""

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


class SqliteLeaseStore(LeaseStore):
    """Cross-worker leases via control-plane DB (works with uvicorn --workers N)."""

    _ensured = False

    def _ensure_table(self) -> None:
        if SqliteLeaseStore._ensured:
            return
        from app import db

        db.execute(
            """
            CREATE TABLE IF NOT EXISTS runtime_start_leases (
                lease_key TEXT PRIMARY KEY,
                token TEXT NOT NULL,
                expires_at REAL NOT NULL
            )
            """
        )
        SqliteLeaseStore._ensured = True

    def try_acquire(self, key: str, *, ttl_seconds: float = 90.0) -> Lease | None:
        from app import db

        self._ensure_table()
        now = time.time()
        token = uuid.uuid4().hex
        expires = now + ttl_seconds
        db.execute("DELETE FROM runtime_start_leases WHERE expires_at < ?", (now,))
        existing = db.fetch_one(
            "SELECT token, expires_at FROM runtime_start_leases WHERE lease_key = ?",
            (key,),
        )
        if existing and float(existing["expires_at"]) > now:
            return None
        if existing:
            db.execute(
                "UPDATE runtime_start_leases SET token = ?, expires_at = ? WHERE lease_key = ? AND expires_at <= ?",
                (token, expires, key, now),
            )
        else:
            try:
                db.execute(
                    "INSERT INTO runtime_start_leases (lease_key, token, expires_at) VALUES (?, ?, ?)",
                    (key, token, expires),
                )
            except Exception:
                # Race: another worker inserted first.
                return None
        row = db.fetch_one(
            "SELECT token FROM runtime_start_leases WHERE lease_key = ?",
            (key,),
        )
        if not row or str(row["token"]) != token:
            return None
        return Lease(key=key, token=token, expires_at=time.monotonic() + ttl_seconds)

    def release(self, lease: Lease) -> None:
        from app import db

        self._ensure_table()
        db.execute(
            "DELETE FROM runtime_start_leases WHERE lease_key = ? AND token = ?",
            (lease.key, lease.token),
        )


class RedisLeaseStore(LeaseStore):
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
            pass
    try:
        _STORE = SqliteLeaseStore()
    except Exception:
        _STORE = InMemoryLeaseStore()
    return _STORE


def reset_lease_store_for_tests() -> None:
    global _STORE
    _STORE = None
    SqliteLeaseStore._ensured = False
