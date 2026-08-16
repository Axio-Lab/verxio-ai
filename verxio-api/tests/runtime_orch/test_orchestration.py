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
from app.runtime_orch.k8s import K8sRuntimeManager, stop_leftover_docker_runtime
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


def test_factory_builds_backends():
    reset_runtime_manager_for_tests()
    assert build_runtime_manager("local-docker").name == "local-docker"
    assert build_runtime_manager("k8s").name == "k8s"
    assert build_runtime_manager("kubernetes").name == "k8s"
    with pytest.raises(ValueError):
        build_runtime_manager("fly")
    with pytest.raises(ValueError):
        build_runtime_manager("nope")


def test_k8s_manifest_render(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_HOST_PATH_ROOT", "/verxio-runtimes")
    monkeypatch.setenv("VERXIO_K8S_CONNECT_MODE", "hostPort")
    monkeypatch.setenv("VERXIO_API_INTERNAL_URL", "http://verxio-api:8787")
    monkeypatch.setenv("VERXIO_PUBLIC_WEB_URL", "http://127.0.0.1:8080")
    mgr = K8sRuntimeManager(namespace="verxio-test")
    manifest = mgr.render_pod_manifest(
        _rt(status="stopped"),
        extra_env={"FOO": "bar"},
        dashboard_token="tok_test",
        host_port=19199,
    )
    assert manifest["kind"] == "Pod"
    assert manifest["metadata"]["namespace"] == "verxio-test"
    env = {e["name"]: e["value"] for e in manifest["spec"]["containers"][0]["env"]}
    assert env["FOO"] == "bar"
    assert env["HERMES_DASHBOARD_PORT"] == "9119"
    assert env["HERMES_DASHBOARD_SESSION_TOKEN"] == "tok_test"
    assert env["VERXIO_RUNTIME_TOKEN"] == "tok_test"
    port = manifest["spec"]["containers"][0]["ports"][0]
    assert port["hostPort"] == 19199
    assert port["name"] == "dashboard"
    webhook = manifest["spec"]["containers"][0]["ports"][1]
    assert webhook["name"] == "webhook"
    assert webhook["containerPort"] == 8644
    assert webhook["hostPort"] == mgr._webhook_host_port_for(_rt(status="stopped"))
    api_server = manifest["spec"]["containers"][0]["ports"][2]
    assert api_server["name"] == "api-server"
    assert api_server["containerPort"] == 8642
    assert api_server["hostPort"] == mgr._api_server_host_port_for(_rt(status="stopped"))
    assert env["VERXIO_HOSTED"] == "1"
    assert env["VERXIO_API_URL"] == "http://verxio-api:8787"
    assert env["VERXIO_WORKSPACE_ID"] == "ws_1"
    assert env["VERXIO_AGENT_ID"] == "agent_1"
    assert env["VERXIO_PUBLIC_WEB_URL"] == "http://127.0.0.1:8080"
    assert env["WHATSAPP_ENABLED"] == "false"
    assert env["WHATSAPP_BROWSER_NAME"] == "Verxio Agent"
    assert manifest["spec"]["restartPolicy"] == "Always"
    probe = manifest["spec"]["containers"][0]["readinessProbe"]["httpGet"]
    assert probe["path"] == "/api/healthz"
    mounts = {m["name"]: m["mountPath"] for m in manifest["spec"]["containers"][0]["volumeMounts"]}
    assert mounts["hermes-home"] == "/opt/data"
    assert mounts["workspace"] == "/workspace"
    vols = {v["name"]: v["hostPath"]["path"] for v in manifest["spec"]["volumes"]}
    assert vols["hermes-home"].startswith("/verxio-runtimes/")
    assert vols["hermes-home"].endswith("/hermes-home")


def test_k8s_manifest_injects_hosted_keys_without_extra_env(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_HOST_PATH_ROOT", "/verxio-runtimes")
    monkeypatch.setenv("VERXIO_K8S_CONNECT_MODE", "hostPort")
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "hosted-gemini")
    monkeypatch.delenv("VERXIO_GOOGLE_API_KEY", raising=False)
    mgr = K8sRuntimeManager(namespace="verxio-test")
    manifest = mgr.render_pod_manifest(
        _rt(status="stopped"),
        dashboard_token="tok_test",
        host_port=19199,
    )
    env = {e["name"]: e["value"] for e in manifest["spec"]["containers"][0]["env"]}
    assert env["GEMINI_API_KEY"] == "hosted-gemini"
    assert env["GOOGLE_API_KEY"] == "hosted-gemini"


def test_stop_leftover_docker_runtime_removes_same_named_container(monkeypatch):
    calls: list[list[str]] = []

    class Result:
        returncode = 0
        stdout = "verxio-ws-65d1bec2c80a-agent-4a1857681ca3\n"
        stderr = ""

    def fake_run(cmd, **_kwargs):
        calls.append(list(cmd))
        return Result()

    monkeypatch.setattr("app.runtime_orch.k8s.subprocess.run", fake_run)
    assert stop_leftover_docker_runtime("verxio-ws-65d1bec2c80a-agent-4a1857681ca3") is True
    assert calls[0] == ["docker", "rm", "-f", "--", "verxio-ws-65d1bec2c80a-agent-4a1857681ca3"]
    assert stop_leftover_docker_runtime("") is False


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

    monkeypatch.setattr(lifecycle, "get_runtime_manager", lambda: FakeManager())
    asyncio.run(lifecycle.wake_runtime(_rt(status="stopped"), reason="test.roll"))
    assert captured["extra_env"]["GEMINI_API_KEY"] == "hosted-gemini"
    assert captured["extra_env"]["GOOGLE_API_KEY"] == "hosted-gemini"


def test_k8s_service_includes_webhook_port(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_CONNECT_MODE", "cluster")
    mgr = K8sRuntimeManager(namespace="verxio-test")
    service = mgr.render_service_manifest(_rt(status="stopped"))
    ports = {p["name"]: p for p in service["spec"]["ports"]}
    assert ports["dashboard"]["port"] == 9119
    assert ports["webhook"]["port"] == 8644
    assert ports["webhook"]["targetPort"] == 8644
    assert ports["api-server"]["port"] == 8642
    assert ports["api-server"]["targetPort"] == 8642


def test_k8s_api_server_address_uses_service_dns_in_cluster_mode(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_CONNECT_MODE", "cluster")
    monkeypatch.setenv("VERXIO_K8S_NAMESPACE", "verxio-test")
    mgr = K8sRuntimeManager(namespace="verxio-test")
    url = asyncio.run(mgr.api_server_address(_rt(status="running", container_name="verxio-ws-1-agent-1")))
    assert url == "http://verxio-ws-1-agent-1.verxio-test.svc.cluster.local:8642"


def test_k8s_health_uses_runtime_health(monkeypatch):
    mgr = K8sRuntimeManager(namespace="verxio-test")
    calls: list[str] = []

    async def fake_health(runtime):
        calls.append(runtime.id)
        return True, "ok"

    monkeypatch.setattr("app.runtime_manager.runtime_health", fake_health)
    ok, detail = asyncio.run(mgr.health(_rt(status="starting")))
    assert ok is True
    assert detail == "ok"
    assert calls == ["rt_test"]


def test_k8s_health_false_when_pod_missing(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_ENABLED", "true")
    mgr = K8sRuntimeManager(namespace="verxio-test")
    mgr.enabled = True
    monkeypatch.setattr(mgr, "_pod_is_live", lambda runtime: False)
    invalidated: list[str] = []
    monkeypatch.setattr(
        "app.runtime_manager.invalidate_runtime_caches",
        lambda runtime: invalidated.append(runtime.id),
    )

    async def boom(_runtime):
        raise AssertionError("runtime_health must not run when the pod is gone")

    monkeypatch.setattr("app.runtime_manager.runtime_health", boom)
    ok, detail = asyncio.run(mgr.health(_rt(status="running")))
    assert ok is False
    assert "not running" in detail
    assert invalidated == ["rt_test"]


def test_reconcile_missing_runtimes_marks_stopped_and_wakes(monkeypatch):
    from app.runtime_orch import lifecycle

    missing = _rt(status="running", id="rt_missing")
    live = _rt(status="running", id="rt_live")
    saved: list[tuple[str, str]] = []
    woken: list[str] = []

    class FakeManager:
        async def health(self, runtime):
            return runtime.id == "rt_live", "ok"

    monkeypatch.setattr(lifecycle, "get_runtime_manager", lambda: FakeManager())
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


def test_k8s_webhook_address_uses_service_dns_in_cluster_mode(monkeypatch):
    monkeypatch.setenv("VERXIO_K8S_CONNECT_MODE", "cluster")
    monkeypatch.setenv("VERXIO_K8S_NAMESPACE", "verxio-test")
    mgr = K8sRuntimeManager(namespace="verxio-test")
    url = asyncio.run(mgr.webhook_address(_rt(status="running", container_name="verxio-ws-1-agent-1")))
    assert url == "http://verxio-ws-1-agent-1.verxio-test.svc.cluster.local:8644"


def test_wake_queue_dedupes():
    q = WakeQueue(maxsize=10)

    async def _run():
        assert await q.enqueue(WakeJob("rt1", "t1", "msg")) is True
        assert await q.enqueue(WakeJob("rt1", "t1", "msg")) is True
        assert await q.depth() == 1

    asyncio.run(_run())


def test_local_docker_manager_stop_uses_runtime_manager(monkeypatch):
    from app.runtime_orch.local_docker import LocalDockerRuntimeManager

    calls: list[str] = []

    async def fake_stop(runtime):
        calls.append(runtime.id)
        return runtime.model_copy(update={"status": "stopped"})

    monkeypatch.setattr("app.runtime_manager.stop_runtime_async", fake_stop)
    mgr = LocalDockerRuntimeManager()
    out = asyncio.run(mgr.stop(_rt(status="running")))
    assert out.status == "stopped"
    assert calls == ["rt_test"]


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
