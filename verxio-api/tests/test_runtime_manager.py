from __future__ import annotations

from datetime import UTC, datetime
from subprocess import CompletedProcess

from app import db
from app import runtime_manager
from app.models import RuntimeInstance


def _runtime() -> RuntimeInstance:
    return RuntimeInstance(
        id="rt-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        agent_id="agent-1",
        mode="local-docker",
        status="running",
        container_name="verxio-ws-1-agent-1",
        dashboard_url="http://172.17.0.1:19119",
        hermes_home_path="/tmp/verxio/hermes-home",
        workspace_path="/tmp/verxio/workspace",
        artifact_path="/tmp/verxio/workspace/artifacts",
    )


def _reset_network_cache() -> None:
    runtime_manager._NETWORK_CACHE = None
    runtime_manager._NETWORK_CACHE_LOADED = False
    runtime_manager._NETWORK_ATTACHED_CACHE.clear()


def test_runtime_dashboard_base_url_prefers_configured_compose_network(monkeypatch):
    _reset_network_cache()
    monkeypatch.setenv("VERXIO_RUNTIME_DOCKER_NETWORK", "verxio-ai_default")

    assert runtime_manager.runtime_dashboard_base_url(_runtime(), ensure_network=False) == (
        "http://verxio-ws-1-agent-1:9119"
    )


def test_ensure_runtime_on_network_connects_once(monkeypatch):
    _reset_network_cache()
    monkeypatch.setenv("VERXIO_RUNTIME_DOCKER_NETWORK", "verxio-ai_default")
    calls: list[list[str]] = []

    def fake_run_docker(args: list[str]) -> CompletedProcess[str]:
        calls.append(args)
        if args[:1] == ["inspect"]:
            return CompletedProcess(args, 0, stdout="<no value>\n", stderr="")
        if args[:2] == ["network", "connect"]:
            return CompletedProcess(args, 0, stdout="", stderr="")
        raise AssertionError(f"Unexpected docker call: {args}")

    monkeypatch.setattr(runtime_manager, "_run_docker", fake_run_docker)

    runtime_manager._ensure_runtime_on_network(_runtime())
    runtime_manager._ensure_runtime_on_network(_runtime())

    assert calls == [
        [
            "inspect",
            "-f",
            '{{index .NetworkSettings.Networks "verxio-ai_default"}}',
            "verxio-ws-1-agent-1",
        ],
        ["network", "connect", "verxio-ai_default", "verxio-ws-1-agent-1"],
    ]


def test_dashboard_port_for_start_reallocates_busy_stored_port(monkeypatch):
    runtime = _runtime().model_copy(update={"dashboard_url": "http://host.docker.internal:19119"})

    def fake_runtime_publish_port_is_free(port: int) -> bool:
        return port == 19120

    monkeypatch.setenv("VERXIO_DASHBOARD_PORT_START", "19119")
    monkeypatch.setattr(runtime_manager, "_runtime_publish_port_is_free", fake_runtime_publish_port_is_free)

    assert runtime_manager._dashboard_port_for_start(runtime) == 19120


def test_runtime_container_env_disables_unpaired_whatsapp(tmp_path):
    runtime = _runtime().model_copy(update={"hermes_home_path": str(tmp_path)})

    env = runtime_manager._runtime_container_env(
        runtime,
        {
            "SLACK_BOT_TOKEN": "xoxb-test",
            "WHATSAPP_ENABLED": "true",
            "EMPTY_VALUE": "",
        },
    )

    assert env["WHATSAPP_ENABLED"] == "false"
    assert env["SLACK_BOT_TOKEN"] == "xoxb-test"
    assert "EMPTY_VALUE" not in env


def test_runtime_container_env_allows_paired_whatsapp(tmp_path):
    runtime = _runtime().model_copy(update={"hermes_home_path": str(tmp_path)})
    session_dir = tmp_path / "platforms" / "whatsapp" / "session"
    session_dir.mkdir(parents=True)
    (session_dir / "creds.json").write_text("{}", encoding="utf-8")

    env = runtime_manager._runtime_container_env(runtime, {"WHATSAPP_ENABLED": "true"})

    assert env["WHATSAPP_ENABLED"] == "true"


def test_index_artifacts_includes_generated_workspace_outputs(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    db.run_migrations()

    workspace = tmp_path / "workspace"
    artifacts = workspace / "artifacts"
    reports = workspace / "reports"
    src = workspace / "src"
    artifacts.mkdir(parents=True)
    reports.mkdir()
    src.mkdir()
    (artifacts / "inside.csv").write_text("item,total\nA,10\n", encoding="utf-8")
    (workspace / "summary.csv").write_text("metric,value\nrevenue,100\n", encoding="utf-8")
    (reports / "chart.png").write_bytes(b"fake-png")
    (src / "app.ts").write_text("export const value = 1\n", encoding="utf-8")

    now = datetime.now(UTC).isoformat()
    db.execute(
        """
        INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        ("user-1", "owner@example.com", "Owner", "hash", 1, now, now),
    )
    db.execute(
        """
        INSERT INTO workspaces (id, tenant_id, name, slug, kind, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("ws-1", "tenant-1", "Workspace", "workspace", "personal", "user-1", now, now),
    )
    db.execute(
        """
        INSERT INTO agents (
            id, tenant_id, workspace_id, name, role, status, description,
            hermes_home_path, workspace_path, artifact_path, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "agent-1",
            "tenant-1",
            "ws-1",
            "Agent",
            "operator",
            "active",
            "",
            str(tmp_path / "home"),
            str(workspace),
            str(artifacts),
            now,
            now,
        ),
    )

    runtime = _runtime().model_copy(update={"workspace_path": str(workspace), "artifact_path": str(artifacts)})
    records = runtime_manager.index_artifacts(runtime)
    by_path = {record.relative_path: record for record in records}

    assert by_path["inside.csv"].source == "workspace"
    assert by_path["workspace/summary.csv"].source == "workspace_root"
    assert by_path["workspace/reports/chart.png"].source == "workspace_root"
    assert "workspace/src/app.ts" not in by_path

    record, path = runtime_manager.artifact_file(runtime, by_path["workspace/summary.csv"].id)
    assert record.file_name == "summary.csv"
    assert path == (workspace / "summary.csv").resolve()


def test_index_artifacts_includes_runtime_home_delivery_artifacts(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    db.run_migrations()

    hermes_home = tmp_path / "home"
    home_artifacts = hermes_home / "artifacts"
    workspace = tmp_path / "workspace"
    artifacts = workspace / "artifacts"
    home_artifacts.mkdir(parents=True)
    artifacts.mkdir(parents=True)
    (home_artifacts / "product_launch_list.csv").write_text("item,category\nSolar Kit,Energy\n", encoding="utf-8")

    now = datetime.now(UTC).isoformat()
    db.execute(
        """
        INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        ("user-1", "owner@example.com", "Owner", "hash", 1, now, now),
    )
    db.execute(
        """
        INSERT INTO workspaces (id, tenant_id, name, slug, kind, created_by, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        ("ws-1", "tenant-1", "Workspace", "workspace", "personal", "user-1", now, now),
    )
    db.execute(
        """
        INSERT INTO agents (
            id, tenant_id, workspace_id, name, role, status, description,
            hermes_home_path, workspace_path, artifact_path, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            "agent-1",
            "tenant-1",
            "ws-1",
            "Agent",
            "operator",
            "active",
            "",
            str(hermes_home),
            str(workspace),
            str(artifacts),
            now,
            now,
        ),
    )

    runtime = _runtime().model_copy(
        update={
            "hermes_home_path": str(hermes_home),
            "workspace_path": str(workspace),
            "artifact_path": str(artifacts),
        }
    )
    records = runtime_manager.index_artifacts(runtime)
    by_path = {record.relative_path: record for record in records}

    record = by_path["runtime-home/artifacts/product_launch_list.csv"]
    assert record.source == "runtime_home"

    public, path = runtime_manager.artifact_file(runtime, record.id)
    assert public.file_name == "product_launch_list.csv"
    assert path == (home_artifacts / "product_launch_list.csv").resolve()


def test_sync_container_workspace_artifacts_mirrors_unreachable_host_path(monkeypatch, tmp_path):
    hermes_home = tmp_path / "home"
    mirror = hermes_home / "artifacts"
    hermes_home.mkdir(parents=True)
    # Simulate an empty ghost artifact dir that the API container can see,
    # while the real generated image only exists in the Hermes container.
    ghost = tmp_path / "ghost-artifacts"
    ghost.mkdir()

    runtime = _runtime().model_copy(
        update={
            "hermes_home_path": str(hermes_home),
            "artifact_path": str(ghost),
            "workspace_path": str(tmp_path / "missing-workspace"),
            "container_name": "verxio-ws-1-agent-1",
        }
    )

    calls: list[list[str]] = []

    def fake_run_docker(args: list[str]) -> CompletedProcess[str]:
        calls.append(args)
        if args[:1] == ["inspect"]:
            return CompletedProcess(args, 0, stdout="true\n", stderr="")
        if args[:2] == ["exec", "verxio-ws-1-agent-1"]:
            return CompletedProcess(args, 0, stdout="", stderr="")
        if args[:1] == ["cp"]:
            mirror.mkdir(parents=True, exist_ok=True)
            (mirror / "man_in_pool.png").write_bytes(b"png-bytes")
            return CompletedProcess(args, 0, stdout="", stderr="")
        raise AssertionError(f"Unexpected docker call: {args}")

    monkeypatch.setattr(runtime_manager, "_run_docker", fake_run_docker)

    synced = runtime_manager._sync_container_workspace_artifacts(runtime)

    assert synced == mirror.resolve()
    assert (mirror / "man_in_pool.png").read_bytes() == b"png-bytes"
    assert calls[0][:1] == ["inspect"]
    assert calls[-1][0] == "cp"
    assert calls[-1][1].endswith(":/workspace/artifacts/.")
