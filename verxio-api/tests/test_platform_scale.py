from __future__ import annotations

from app.channels.creds import decrypt_blob, encrypt_blob, upsert_credential, load_credential
from app.channels.shards import drain_plan, shard_for
from app.homes import copy_home_filtered, snapshot_key
from app.infra.redis import enqueue, read_group, release_lease, try_acquire_lease
from app.models import RuntimeInstance


def test_encrypt_roundtrip():
    blob = encrypt_blob('{"creds":"baileys"}')
    assert decrypt_blob(blob) == '{"creds":"baileys"}'


def test_shard_is_stable_and_drain_skips_lost():
    first = shard_for("ws_a", "agent_a", shards=4)
    assert first == shard_for("ws_a", "agent_a", shards=4)
    assert first not in drain_plan(first, shards=4)
    assert len(drain_plan(first, shards=4)) == 3


def test_memory_queue_and_lease(monkeypatch):
    monkeypatch.delenv("VERXIO_REDIS_URL", raising=False)
    message_id = enqueue("verxio:test", {"kind": "turn", "workspace_id": "ws"})
    assert message_id
    rows = read_group("verxio:test", "g", "c", count=1, block_ms=50)
    assert rows and rows[0][1]["kind"] == "turn"
    token = try_acquire_lease("tenant:ws:agent", ttl_seconds=30, token="worker-1")
    assert token == "worker-1"
    assert try_acquire_lease("tenant:ws:agent", ttl_seconds=30) is None
    release_lease("tenant:ws:agent", token)
    assert try_acquire_lease("tenant:ws:agent", ttl_seconds=30, token="worker-2") == "worker-2"
    release_lease("tenant:ws:agent", "worker-2")


def test_home_copy_skips_cache(tmp_path):
    source = tmp_path / "home"
    (source / "cache").mkdir(parents=True)
    (source / "cache" / "blob").write_text("skip")
    (source / "config.yaml").write_text("model: qwen")
    (source / "config.yaml.bak-1").write_text("old")
    dest = tmp_path / "out"
    copy_home_filtered(source, dest)
    assert (dest / "config.yaml").is_file()
    assert not (dest / "cache").exists()
    assert not (dest / "config.yaml.bak-1").exists()


def test_snapshot_key():
    runtime = RuntimeInstance(
        id="rt",
        tenant_id="t",
        workspace_id="ws",
        agent_id="ag",
        mode="pool",
        status="stopped",
        hermes_home_path="/tmp/h",
        workspace_path="/tmp/w",
        artifact_path="/tmp/a",
    )
    assert snapshot_key(runtime) == "homes/ws/ag/hermes-home"


def test_credential_store(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "control.sqlite3"))
    from app import db

    db.run_migrations()
    upsert_credential(
        tenant_id="t",
        workspace_id="ws",
        agent_id="ag",
        platform="whatsapp",
        plaintext='{"me":"1"}',
    )
    assert load_credential("ws", "ag", "whatsapp") == '{"me":"1"}'


def test_plane_flag_selects_manager(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "plane.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MANAGER", "local-docker")
    monkeypatch.delenv("VERXIO_REDIS_URL", raising=False)
    from app import db, plane
    from app.runtime_orch.factory import manager_name_for_runtime

    db.run_migrations()
    runtime = RuntimeInstance(
        id="rt",
        tenant_id="t",
        workspace_id="ws",
        agent_id="ag",
        mode="hermes",
        status="stopped",
        hermes_home_path="/tmp/h",
        workspace_path="/tmp/w",
        artifact_path="/tmp/a",
    )
    assert plane.resolve_plane("ws", "ag") == "docker"
    assert manager_name_for_runtime(runtime) == "local-docker"

    assert plane.set_plane("ws", "ag", "pool") == "pool"
    assert plane.resolve_plane("ws", "ag") == "pool"
    assert plane.tenant_uses_pool("ws", "ag")
    assert manager_name_for_runtime(runtime) == "pool"

    # A live runtime keeps the backend that started it until it stops.
    live = runtime.model_copy(update={"status": "running", "manager": "local-docker"})
    assert manager_name_for_runtime(live) == "local-docker"
    stopped = live.model_copy(update={"status": "stopped"})
    assert manager_name_for_runtime(stopped) == "pool"

    assert plane.main(["get", "ws", "ag"]) == 0
    assert plane.migrate_all("pool") == 0
    assert [row["agent_id"] for row in plane.list_planes("pool")] == ["ag"]
