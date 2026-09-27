"""DB access: bounded executor pool + stale persistent-connection healing."""

from __future__ import annotations

import asyncio
import threading

import pytest

from app import db


@pytest.fixture(autouse=True)
def _sqlite_tmp(tmp_path, monkeypatch):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "pool.sqlite3"))
    monkeypatch.delenv("VERXIO_DB_PERSISTENT_CONNECTIONS", raising=False)
    monkeypatch.delenv("VERXIO_DB_POOL_SIZE", raising=False)
    db.reset_db_executor_for_tests()
    yield
    db.reset_db_executor_for_tests()


def test_async_helpers_run_on_bounded_db_pool(monkeypatch):
    monkeypatch.setenv("VERXIO_DB_POOL_SIZE", "3")
    db.execute("CREATE TABLE IF NOT EXISTS t (v INTEGER)")
    seen: set[str] = set()

    def record(sql, params=()):
        seen.add(threading.current_thread().name)
        return db.fetch_all(sql, params)

    async def run():
        await asyncio.gather(*(db._run_db(record, "SELECT 1 AS v") for _ in range(24)))

    asyncio.run(run())
    assert seen and all(name.startswith("verxio-db") for name in seen)
    assert len(seen) <= 3


def test_afetch_roundtrip():
    async def run():
        await db.aexecute("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)")
        await db.aexecute("INSERT INTO kv (k, v) VALUES (?, ?)", ("a", "1"))
        row = await db.afetch_one("SELECT v FROM kv WHERE k = ?", ("a",))
        rows = await db.afetch_all("SELECT k FROM kv")
        return row, rows

    row, rows = asyncio.run(run())
    assert row == {"v": "1"}
    assert rows == [{"k": "a"}]


def test_persistent_connection_dropped_after_error(monkeypatch):
    monkeypatch.setenv("VERXIO_DB_PERSISTENT_CONNECTIONS", "1")
    db.execute("CREATE TABLE IF NOT EXISTS t2 (v INTEGER)")
    first = getattr(db._THREAD_LOCAL, "connection", None)
    assert first is not None

    with pytest.raises(Exception):
        db.execute("SELECT * FROM definitely_missing_table")

    # The poisoned connection is gone; the next statement reconnects and works.
    assert getattr(db._THREAD_LOCAL, "connection", None) is None
    assert db.fetch_one("SELECT 1 AS ok") == {"ok": 1}
    assert getattr(db._THREAD_LOCAL, "connection", None) is not first
    db._drop_persistent_connection()
