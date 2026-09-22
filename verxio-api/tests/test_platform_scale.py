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


def test_cron_store_schedules_delivery_and_postback(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "cron.sqlite3"))
    monkeypatch.delenv("VERXIO_REDIS_URL", raising=False)
    from datetime import datetime, timedelta, timezone

    from app import cron_store, db
    from app.infra.redis import STREAM_TURNS, read_group

    db.run_migrations()
    assert cron_store.parse_schedule("every 30m") == {"kind": "interval", "minutes": 30}
    assert cron_store.parse_schedule("0 9 * * *") == {"kind": "cron", "expr": "0 9 * * *"}
    assert cron_store.parse_schedule({"kind": "once", "run_at": "2030-01-01T00:00:00+00:00"})["kind"] == "once"
    assert cron_store.delivery_target({"deliver": "origin", "origin": {"platform": "telegram", "chat_id": "42"}}) == {
        "platform": "telegram",
        "chat_id": "42",
    }
    assert cron_store.delivery_target({"deliver": "discord:123"}) == {"platform": "discord", "chat_id": "123"}
    assert cron_store.delivery_target({"deliver": "local"}) is None

    home = tmp_path / "home"
    (home / "cron").mkdir(parents=True)
    (home / "cron" / "jobs.json").write_text(
        '{"jobs": [{"id": "hj1", "name": "report", "schedule": {"kind": "interval", "minutes": 5}, "stats": {}}]}'
    )
    count = cron_store.upsert_cron_jobs(
        tenant_id="t",
        workspace_id="ws",
        agent_id="ag",
        jobs=[
            {
                "id": "hj1",
                "name": "report",
                "schedule": {"kind": "interval", "minutes": 5},
                "prompt": "Summarise",
                "deliver": "origin",
                "origin": {"platform": "telegram", "chat_id": "42"},
            },
            {"id": "bad", "name": "bad", "schedule": "not a schedule"},
        ],
    )
    assert count == 1
    row = db.fetch_one("SELECT * FROM tenant_cron_jobs WHERE name = 'report'")
    assert row and row["next_run_at"]
    # Force it due and fire.
    past = (datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat()
    db.execute("UPDATE tenant_cron_jobs SET next_run_at = ? WHERE id = ?", (past, row["id"]))
    fired = cron_store.enqueue_due_cron_jobs()
    assert fired == [row["id"]]
    messages = read_group(STREAM_TURNS, "test-cron", "c", count=5, block_ms=50)
    bodies = [m[1] for m in messages]
    assert bodies and bodies[-1]["kind"] == "turn"
    import json as _json

    raw = bodies[-1].get("payload")
    body = _json.loads(raw) if isinstance(raw, str) else raw
    assert body["source"] == "cron" and body["prompt"] == "Summarise"
    assert body["deliver"] == {"platform": "telegram", "chat_id": "42"}
    after = db.fetch_one("SELECT * FROM tenant_cron_jobs WHERE id = ?", (row["id"],))
    assert after["next_run_at"] > past and after["last_status"] == "running"

    cron_store.record_cron_result(row["id"], status="completed", output="done", error=None, home=home)
    final = db.fetch_one("SELECT * FROM tenant_cron_jobs WHERE id = ?", (row["id"],))
    assert final["last_status"] == "completed" and final["last_output"] == "done"
    mirrored = _json.loads((home / "cron" / "jobs.json").read_text())["jobs"][0]
    assert mirrored["last_status"] == "ok" and mirrored["stats"]["completed"] == 1 and mirrored["last_run_at"]
