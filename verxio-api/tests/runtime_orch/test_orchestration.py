"""Unit + integration tests for runtime orchestration (real FS; docker via script)."""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from app.models import RuntimeInstance
from app.runtime_orch.artifacts_store import LocalArtifactStore
from app.runtime_orch.cells import cell_for_tenant
from app.runtime_orch.factory import build_runtime_manager, reset_runtime_manager_for_tests
from app.runtime_orch.idle import resolve_idle_policy
from app.runtime_orch.leases import InMemoryLeaseStore, reset_lease_store_for_tests
from app.runtime_orch.states import RuntimeStatus, assert_transition, is_warm, normalize_status
from app.runtime_orch.wake_queue import WakeJob, WakeQueue


def _rt(**overrides) -> RuntimeInstance:
    base = dict(
        id="rt_test",
        tenant_id="tenant_1",
        workspace_id="ws_1",
        agent_id="agent_1",
        mode="local-docker",
        status="stopped",
        hermes_home_path="/tmp/verxio-test/hermes-home",
        workspace_path="/tmp/verxio-test/workspace",
        artifact_path="/tmp/verxio-test/workspace/artifacts",
    )
    base.update(overrides)
    return RuntimeInstance(**base)


def test_state_machine_allows_start_path():
    assert assert_transition("stopped", "starting") == RuntimeStatus.STARTING
    assert assert_transition("starting", "running") == RuntimeStatus.RUNNING
    assert assert_transition("running", "draining") == RuntimeStatus.DRAINING
    assert assert_transition("draining", "stopped") == RuntimeStatus.STOPPED


def test_state_machine_rejects_illegal():
    with pytest.raises(ValueError, match="Illegal"):
        assert_transition("stopped", "running")


def test_normalize_unknown_is_error():
    assert normalize_status("bogus") == RuntimeStatus.ERROR
    assert is_warm("running")
    assert not is_warm("stopped")


def test_idle_policies():
    free = resolve_idle_policy("free")
    assert free.idle_ttl_seconds == 900
    pro = resolve_idle_policy("pro")
    assert pro.cold_start_slo_seconds == 15
    always = resolve_idle_policy("always_on")
    assert always.idle_ttl_seconds == 0


def test_in_memory_lease_exclusive():
    reset_lease_store_for_tests()
    store = InMemoryLeaseStore()
    a = store.try_acquire("runtime-start:rt1", ttl_seconds=30)
    b = store.try_acquire("runtime-start:rt1", ttl_seconds=30)
    assert a is not None
    assert b is None
    store.release(a)
    c = store.try_acquire("runtime-start:rt1", ttl_seconds=30)
    assert c is not None


def test_local_artifact_store_roundtrip(tmp_path: Path):
    src = tmp_path / "home"
    src.mkdir()
    (src / "MEMORY.md").write_text("hello memory", encoding="utf-8")
    store = LocalArtifactStore(root=tmp_path / "snapshots")
    key = "runtimes/ws/agent/hermes-home"
    store.put_directory(key, src)
    assert store.exists(key)
    dest = tmp_path / "restored"
    assert store.restore_directory(key, dest) is True
    assert (dest / "MEMORY.md").read_text(encoding="utf-8") == "hello memory"


def test_cell_assignment_single_and_multi(monkeypatch):
    monkeypatch.setenv("VERXIO_CELL_COUNT", "1")
    c1 = cell_for_tenant("tenant_abc")
    assert c1.id == "cell_default"
    monkeypatch.setenv("VERXIO_CELL_COUNT", "4")
    c2 = cell_for_tenant("tenant_abc")
    assert c2.id.startswith("cell_")
    assert cell_for_tenant("tenant_abc").id == c2.id


def test_factory_builds_pool_only(monkeypatch):
    from app.runtime_orch.factory import LegacyPlaneDisabled

    reset_runtime_manager_for_tests()
    assert build_runtime_manager("pool").name == "pool"
    with pytest.raises(LegacyPlaneDisabled):
        build_runtime_manager("local-docker")
    with pytest.raises(LegacyPlaneDisabled):
        build_runtime_manager("k8s")
    with pytest.raises(ValueError):
        build_runtime_manager("fly")


def test_wake_runtime_injects_hosted_keys_when_caller_omits_extra_env(monkeypatch):
    from app.runtime_orch import lifecycle
    from app.runtime_orch.leases import InMemoryLeaseStore

    captured: dict[str, dict[str, str] | None] = {}
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "hosted-gemini")
    monkeypatch.delenv("VERXIO_GOOGLE_API_KEY", raising=False)
    monkeypatch.setattr(lifecycle, "get_lease_store", lambda: InMemoryLeaseStore())
    monkeypatch.setattr(lifecycle, "restore_hermes_home", lambda *_a, **_k: False)
    monkeypatch.setattr(lifecycle, "touch_runtime_activity", lambda runtime: runtime)

    class FakeManager:
        name = "fake"

        async def health(self, runtime):
            return False, "stopped"

        async def start(self, runtime, extra_env=None, wait_ready=True):
            captured["extra_env"] = extra_env
            return runtime

    monkeypatch.setattr(lifecycle, "get_runtime_manager", lambda *_a, **_k: FakeManager())
    asyncio.run(lifecycle.wake_runtime(_rt(status="stopped"), reason="test.roll"))
    assert captured["extra_env"]["GEMINI_API_KEY"] == "hosted-gemini"
    assert captured["extra_env"]["GOOGLE_API_KEY"] == "hosted-gemini"


def test_reconcile_missing_runtimes_marks_stopped_and_wakes(monkeypatch):
    from app.runtime_orch import lifecycle

    missing = _rt(status="running", id="rt_missing")
    live = _rt(status="running", id="rt_live")
    saved: list[tuple[str, str]] = []
    woken: list[str] = []

    class FakeManager:
        async def health(self, runtime):
            return runtime.id == "rt_live", "ok"

    monkeypatch.setattr(lifecycle, "get_runtime_manager", lambda *_a, **_k: FakeManager())
    monkeypatch.setattr(
        lifecycle.db,
        "fetch_all",
        lambda *_a, **_k: [missing.model_dump(), live.model_dump()],
    )
    monkeypatch.setattr(lifecycle, "runtime_from_row", lambda row: _rt(**row) if isinstance(row, dict) else row)
    monkeypatch.setattr(
        lifecycle,
        "save_runtime",
        lambda runtime, **fields: saved.append((runtime.id, str(fields.get("status")))) or runtime,
    )
    monkeypatch.setattr("app.runtime_manager.invalidate_runtime_caches", lambda runtime: None)

    async def fake_enqueue(runtime, *, reason):
        woken.append(f"{runtime.id}:{reason}")
        return True

    monkeypatch.setattr(lifecycle, "enqueue_wake", fake_enqueue)
    result = asyncio.run(lifecycle.reconcile_missing_runtimes(wake=True, reason="test.wipe"))
    assert result["missing"] == ["rt_missing"]
    assert result["woken"] == ["rt_missing"]
    assert saved == [("rt_missing", "stopped")]
    assert woken == ["rt_missing:test.wipe"]


def test_watchdog_escalates_dashboard_restart_then_compute(monkeypatch):
    from app.runtime_orch import watchdog

    watchdog.reset_for_tests()
    monkeypatch.setenv("VERXIO_RUNTIME_WATCHDOG_FAILURES", "2")
    rt = _rt(status="running", id="rt_wedged", dashboard_url="http://runtime:9119")
    calls: list[str] = []

    class FakeManager:
        name = "k8s"

        async def restart_dashboard(self, runtime, *, force=False):
            calls.append(f"dashboard:{'kill' if force else 'term'}")
            return True

        async def restart(self, runtime, *, extra_env=None):
            calls.append("compute")
            return runtime

    monkeypatch.setattr(watchdog, "get_runtime_manager", lambda *_a, **_k: FakeManager())
    monkeypatch.setattr(watchdog.db, "fetch_all", lambda *_a, **_k: [rt.model_dump()])
    monkeypatch.setattr(watchdog, "runtime_from_row", lambda row: _rt(**row))

    healthy = {"ok": False}

    async def fake_probe(runtime):
        return healthy["ok"]

    monkeypatch.setattr(watchdog, "probe_healthz", fake_probe)

    async def tick():
        return await watchdog.heal_unhealthy_runtimes()

    results = [asyncio.run(tick()) for _ in range(6)]
    # Threshold 2: term at 2, kill at 4, compute restart at 6.
    assert calls == ["dashboard:term", "dashboard:kill", "compute"]
    assert results[1]["healed"] == ["rt_wedged:restart-dashboard"]
    assert results[3]["healed"] == ["rt_wedged:restart-dashboard-kill"]
    assert results[5]["healed"] == ["rt_wedged:restart-compute"]
    assert all(r["unhealthy"] == ["rt_wedged"] for r in results)

    healthy["ok"] = True
    ok = asyncio.run(tick())
    assert ok == {"unhealthy": [], "healed": []}
    assert watchdog.tracked_failures("rt_wedged") == 0


def test_watchdog_skips_managers_without_dashboard_restart_until_top_rung(monkeypatch):
    from app.runtime_orch import watchdog

    watchdog.reset_for_tests()
    monkeypatch.setenv("VERXIO_RUNTIME_WATCHDOG_FAILURES", "1")
    rt = _rt(status="running", id="rt_pool", manager="pool")
    calls: list[str] = []

    class PoolManager:
        name = "pool"

        async def restart(self, runtime, *, extra_env=None):
            calls.append("compute")
            return runtime

    monkeypatch.setattr(watchdog, "get_runtime_manager", lambda *_a, **_k: PoolManager())
    monkeypatch.setattr(watchdog.db, "fetch_all", lambda *_a, **_k: [rt.model_dump()])
    monkeypatch.setattr(watchdog, "runtime_from_row", lambda row: _rt(**row))

    async def never_ok(runtime):
        return False

    monkeypatch.setattr(watchdog, "probe_healthz", never_ok)
    for _ in range(2):
        asyncio.run(watchdog.heal_unhealthy_runtimes())
    assert calls == []
    asyncio.run(watchdog.heal_unhealthy_runtimes())
    assert calls == ["compute"]


def test_wake_queue_dedupes():
    q = WakeQueue(maxsize=10)

    async def _run():
        assert await q.enqueue(WakeJob("rt1", "t1", "msg")) is True
        assert await q.enqueue(WakeJob("rt1", "t1", "msg")) is True
        assert await q.depth() == 1

    asyncio.run(_run())


def test_list_idle_candidates_respects_ttl(monkeypatch):
    from app.runtime_orch import lifecycle

    stale = _rt(
        status="running",
        last_seen_at=(datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
        idle_policy="free",
    )
    fresh = _rt(
        id="rt_fresh",
        status="running",
        last_seen_at=datetime.now(timezone.utc).isoformat(),
        idle_policy="free",
    )

    monkeypatch.setattr(lifecycle, "idle_enabled", lambda: True)
    monkeypatch.setattr(
        lifecycle.db,
        "fetch_all",
        lambda *_a, **_k: [stale.model_dump(), fresh.model_dump()],
    )
    monkeypatch.setattr(lifecycle, "runtime_from_row", lambda row: RuntimeInstance(**row))
    cands = lifecycle.list_idle_candidates()
    assert [c.id for c in cands] == ["rt_test"]


def test_checkpoint_restore_roundtrip(tmp_path, monkeypatch):
    from app.runtime_orch import checkpoints
    from app.runtime_orch.artifacts_store import LocalArtifactStore

    home = tmp_path / "hermes-home"
    home.mkdir()
    (home / "USER.md").write_text("prefers concise", encoding="utf-8")
    store = LocalArtifactStore(root=tmp_path / "snap")
    monkeypatch.setattr(checkpoints, "get_artifact_store", lambda: store)

    rt = _rt(hermes_home_path=str(home))
    assert checkpoints.checkpoint_hermes_home(rt)
    # Simulate wiped node
    import shutil

    shutil.rmtree(home)
    assert checkpoints.restore_hermes_home(rt, only_if_missing=True) is True
    assert (home / "USER.md").read_text(encoding="utf-8") == "prefers concise"


def test_sqlite_lease_store_exclusive(tmp_path, monkeypatch):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "leases.sqlite3"))
    from app import db
    from app.runtime_orch.leases import SqliteLeaseStore, reset_lease_store_for_tests

    reset_lease_store_for_tests()
    db.run_migrations()
    store = SqliteLeaseStore()
    a = store.try_acquire("runtime-start:x", ttl_seconds=30)
    b = store.try_acquire("runtime-start:x", ttl_seconds=30)
    assert a is not None
    assert b is None
    store.release(a)
    c = store.try_acquire("runtime-start:x", ttl_seconds=30)
    assert c is not None


def test_draining_can_restart():
    assert assert_transition("draining", "starting") == RuntimeStatus.STARTING
