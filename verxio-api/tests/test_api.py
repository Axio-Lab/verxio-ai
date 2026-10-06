from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import os
import sqlite3
import time
from pathlib import Path
from subprocess import CompletedProcess

import pytest
import yaml
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import composio_catalog, control_plane, db, emailer, inference, main, runtime_manager, transcription_catalog
from app.auth import SESSION_COOKIE
from app.main import app
from app.models import ComposioConnectedAccount, ComposioToolBridgeStatus, RuntimeInstance

def test_migrations_upgrade_legacy_workflow_trigger_schedule_columns(monkeypatch, tmp_path):
    database_path = tmp_path / "legacy-control.sqlite3"
    with sqlite3.connect(database_path) as conn:
        conn.execute(
            """
            CREATE TABLE workflow_triggers (
                id TEXT PRIMARY KEY,
                tenant_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                workflow_agent_id TEXT NOT NULL,
                trigger_type TEXT NOT NULL,
                event_name TEXT NOT NULL DEFAULT '',
                name TEXT NOT NULL DEFAULT '',
                enabled INTEGER NOT NULL DEFAULT 1,
                secret TEXT NOT NULL DEFAULT '',
                config_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )

    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(database_path))

    db.run_migrations()

    with sqlite3.connect(database_path) as conn:
        columns = {str(row[1]) for row in conn.execute("PRAGMA table_info(workflow_triggers)")}
        indexes = {str(row[1]) for row in conn.execute("PRAGMA index_list(workflow_triggers)")}

    assert {"next_run_at", "last_run_at", "claim_token", "claimed_at"} <= columns
    assert "idx_workflow_triggers_schedule_due" in indexes

@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_WORKFLOW_SCHEDULER_ENABLED", "0")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.setenv("VERXIO_SIGNUP_INVITE_CODE", "97685")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    monkeypatch.delenv("VERXIO_SMTP_FROM", raising=False)
    monkeypatch.setattr(control_plane, "RUNTIME_ROOT", tmp_path / "runtimes")
    # Production tenants dispatch workflow runs to the pool. These tests
    # exercise the inline engine the worker runs after it claims a turn.
    monkeypatch.setattr("app.plane.tenant_uses_pool", lambda *_args, **_kwargs: False)
    emailer.SENT_AUTH_EMAILS.clear()
    from app.runtime_orch.leases import reset_lease_store_for_tests

    reset_lease_store_for_tests()
    db.run_migrations()

    with TestClient(app) as test_client:
        yield test_client

def latest_auth_code(email: str, purpose: str) -> str:
    for message in reversed(emailer.SENT_AUTH_EMAILS):
        if message["to"] == email and message["purpose"] == purpose:
            return message["code"]
    raise AssertionError(f"No {purpose} code sent to {email}.")

def signup(client: TestClient, email: str = "ada@example.com") -> tuple[dict, str]:
    response = client.post(
        "/api/auth/signup",
        json={
            "email": email,
            "invite_code": "97685",
            "name": email.split("@")[0].title(),
            "password": "password-123",
        },
    )
    assert response.status_code == 200
    assert response.cookies.get(SESSION_COOKIE) is None
    assert response.json()["purpose"] == "email_verify"

    verify = client.post(
        "/api/auth/verify-email",
        json={"email": email, "code": latest_auth_code(email, "email_verify")},
    )
    assert verify.status_code == 200
    token = verify.cookies.get(SESSION_COOKIE)
    assert token
    return verify.json(), token

def test_bootstrap_contains_verxio_profile(client):
    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["workspace"]["id"] == "local-verxio"
    assert payload["profile"]["id"] == "verxio-agent"
    assert "Hermes" not in payload["profile"]["role"]
    assert "Hermes" not in payload["profile"]["description"]
    assert all("Hermes" not in item for item in payload["profile"]["capabilities"])
    assert payload["runtime"]["mode"] == "demo"

def test_bootstrap_skips_local_hermes_on_hosted_control_plane(client, monkeypatch):
    monkeypatch.setenv("VERXIO_RUNTIME_MANAGER", "local-docker")

    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtime"]["configured"] is True
    assert payload["runtime"]["connected"] is True
    assert "hosted control plane" in payload["runtime"]["detail"].lower()
    assert payload["hermes"]["errors"] == []

def test_bootstrap_skips_shared_hermes_on_k8s_control_plane(client, monkeypatch):
    monkeypatch.setenv("VERXIO_RUNTIME_MANAGER", "k8s")

    response = client.get("/api/bootstrap")

    assert response.status_code == 200
    payload = response.json()
    assert payload["runtime"]["configured"] is True
    assert payload["runtime"]["connected"] is True
    assert "hosted control plane" in payload["runtime"]["detail"].lower()
    assert payload["hermes"]["errors"] == []

def test_legacy_runs_routes_are_gone(client):
    response = client.post(
        "/api/runs",
        json={
            "agent_id": "verxio-agent",
            "input": "Help me use Verxio instead of Hermes CLI.",
        },
    )
    assert response.status_code == 404

def test_protected_runtime_endpoint_rejects_anonymous_users(client):
    response = client.get("/api/runtime")

    assert response.status_code == 401

def test_sync_runtime_workspace_updates_mount_paths(client, monkeypatch, tmp_path):
    payload, _token = signup(client)
    local_workspace = tmp_path / "Documents" / "Verxio"

    async def fake_restart(runtime, extra_env=None):
        return runtime

    # Desktop device sync is allowed when explicitly opted in (macOS desktop does
    # this implicitly; Linux CI needs the flag).
    monkeypatch.setenv("VERXIO_ALLOW_EXTERNAL_WORKSPACE", "1")
    monkeypatch.setattr("app.runtime_manager.restart_runtime", fake_restart)

    response = client.post(
        "/api/runtime/workspace",
        json={"workspace_path": str(local_workspace)},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["runtime"]["workspace_path"] == str(local_workspace.resolve())
    assert body["runtime"]["artifact_path"] == str((local_workspace / "artifacts").resolve())

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    assert runtime_row["workspace_path"] == str(local_workspace.resolve())
    assert (local_workspace / "artifacts").is_dir()

def test_hosted_workspace_heals_stale_desktop_device_path(client, monkeypatch, tmp_path):
    payload, token = signup(client, "hosted-workspace-heal@example.com")
    stale = tmp_path / "Users" / "donatusprince" / "Documents" / "Verxio"
    stale.mkdir(parents=True)
    (stale / "note.txt").write_text("keep me", encoding="utf-8")

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    db.execute(
        """
        UPDATE runtime_instances
        SET workspace_path = ?, artifact_path = ?
        WHERE id = ?
        """,
        (str(stale), str(stale / "artifacts"), runtime_row["id"]),
    )

    monkeypatch.delenv("VERXIO_ALLOW_EXTERNAL_WORKSPACE", raising=False)
    monkeypatch.setattr(control_plane, "enforce_managed_workspace", lambda: True)

    runtime = control_plane.runtime_from_row(
        db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime_row["id"],)) or {}
    )
    healed = control_plane.ensure_runtime_directories(runtime)

    assert healed.workspace_path.startswith(str(control_plane.RUNTIME_ROOT.resolve()))
    assert healed.workspace_path.endswith("/workspace")
    assert (Path(healed.workspace_path) / "note.txt").read_text(encoding="utf-8") == "keep me"

    # Hosted sync must not re-bind a device path.
    async def fake_restart(runtime, extra_env=None):
        return runtime

    monkeypatch.setattr("app.runtime_manager.restart_runtime", fake_restart)
    response = client.post(
        "/api/runtime/workspace",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"workspace_path": str(stale)},
    )
    assert response.status_code == 200
    assert response.json()["runtime"]["workspace_path"] == healed.workspace_path

def test_protected_composio_endpoint_rejects_anonymous_users(client):
    response = client.get("/api/composio/connections/apps")

    assert response.status_code == 401

def test_inference_catalog_defaults_to_verxio_qwen(client):
    _payload, token = signup(client, "inference-catalog@example.com")

    response = client.get("/api/inference/catalog", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["defaultModelId"] == "verxio-qwen"
    assert len(body["models"]) == 2
    qwen_model = next(model for model in body["models"] if model["id"] == "verxio-qwen")
    gemini_model = next(model for model in body["models"] if model["id"] == "verxio-gemini")
    assert qwen_model["id"] == "verxio-qwen"
    assert qwen_model["default"] is True
    assert qwen_model["providerSlug"] == "alibaba"
    assert qwen_model["displayName"] == "Verxio Qwen"
    assert qwen_model["upstreamModelId"] == "qwen3.6-plus"
    assert qwen_model["availableModelIds"][0] == "qwen3.6-plus"
    assert "kimi-k2.5" in qwen_model["availableModelIds"]
    assert "glm-5" in qwen_model["availableModelIds"]
    assert "MiniMax-M2.5" in qwen_model["availableModelIds"]
    assert "DASHSCOPE_API_KEY" in qwen_model["requiredEnvVars"]
    assert gemini_model["providerSlug"] == "gemini"
    assert gemini_model["displayName"] == "Verxio Gemini"
    assert gemini_model["upstreamModelId"] == "gemini-flash-lite-latest"
    assert gemini_model["availableModelIds"][0] == "gemini-flash-lite-latest"
    assert "gemini-3-pro-preview" in gemini_model["availableModelIds"]
    assert "gemini-2.5-pro" in gemini_model["availableModelIds"]
    assert gemini_model["default"] is False
    assert "GEMINI_API_KEY" in gemini_model["requiredEnvVars"]

def test_inference_catalog_uses_hermes_provider_models(client, monkeypatch):
    _payload, token = signup(client, "inference-hermes-catalog@example.com")
    monkeypatch.setattr(
        inference,
        "_hermes_provider_model_ids",
        lambda model: ("qwen-from-hermes", "glm-from-hermes") if model.provider_slug == "alibaba" else (),
    )

    response = client.get("/api/inference/catalog", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    qwen_model = next(model for model in response.json()["models"] if model["id"] == "verxio-qwen")
    assert qwen_model["availableModelIds"][:3] == [
        "qwen3.6-plus",
        "qwen-from-hermes",
        "glm-from-hermes",
    ]

def test_inference_catalog_passes_hosted_key_to_hermes(client, monkeypatch):
    _payload, token = signup(client, "inference-hosted-hermes-key@example.com")
    observed: list[dict[str, str | None]] = []

    class FakeHermesModels:
        @staticmethod
        def provider_model_ids(provider_slug: str, force_refresh: bool = False) -> list[str]:
            observed.append(
                {
                    "provider_slug": provider_slug,
                    "force_refresh": str(force_refresh),
                    "dashscope": os.getenv("DASHSCOPE_API_KEY"),
                }
            )
            return ["deepseek-v4-flash", "happy-horse-model"]

    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "hosted-qwen-secret")
    monkeypatch.delenv("DASHSCOPE_API_KEY", raising=False)
    monkeypatch.setattr(inference.importlib, "import_module", lambda name: FakeHermesModels)

    response = client.get("/api/inference/catalog", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    qwen_model = next(model for model in response.json()["models"] if model["id"] == "verxio-qwen")
    assert "deepseek-v4-flash" in qwen_model["availableModelIds"]
    assert "happy-horse-model" in qwen_model["availableModelIds"]
    alibaba_call = next(call for call in observed if call["provider_slug"] == "alibaba")
    assert alibaba_call == {
        "provider_slug": "alibaba",
        "force_refresh": "True",
        "dashscope": "hosted-qwen-secret",
    }
    assert os.getenv("DASHSCOPE_API_KEY") is None

def test_inference_settings_are_hosted_verxio_qwen_by_default(client):
    _payload, token = signup(client, "inference-settings@example.com")

    response = client.get("/api/inference/settings", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    assert response.json()["mode"] == "hosted"
    assert response.json()["defaultModelId"] == "verxio-qwen"

def test_transcription_catalog_rejects_anonymous_users(client):
    response = client.get("/api/transcription/catalog")

    assert response.status_code == 401

def test_dashboard_env_mutations_mark_hosted_inference_reassert_paths():
    """Env writes are flagged, but the proxy must not docker-restart on them."""
    assert main._dashboard_path_needs_inference_env_reassert("api/env/reload", "POST")
    assert main._dashboard_path_needs_inference_env_reassert("api/env", "PUT")
    assert main._dashboard_path_needs_inference_env_reassert("api/tools/toolsets/tts/env", "PUT")
    assert not main._dashboard_path_needs_inference_env_reassert("api/model/options", "GET")
    assert not main._dashboard_path_needs_inference_env_reassert("api/status", "GET")

def test_dashboard_toolset_paths_use_fast_proxy_path():
    """Provider/env/config toolset routes must skip the start_runtime lock."""
    assert main._dashboard_path_is_toolset_fast_path("api/tools/toolsets")
    assert main._dashboard_path_is_toolset_fast_path("api/tools/toolsets/image_gen/config")
    assert main._dashboard_path_is_toolset_fast_path("api/tools/toolsets/image_gen/provider")
    assert main._dashboard_path_is_toolset_fast_path("api/tools/toolsets/video_gen/env")
    assert not main._dashboard_path_is_toolset_fast_path("api/config")
    assert not main._dashboard_path_is_toolset_fast_path("api/model/info")

def test_dashboard_session_mutations_use_fast_proxy_path():
    """Session delete/rename must skip awaited bridge sync + start_runtime."""
    assert main._dashboard_path_is_session_mutation_fast_path(
        "api/sessions/20260803_112520_46b5fa", "DELETE"
    )
    assert main._dashboard_path_is_session_mutation_fast_path(
        "api/sessions/20260803_112520_46b5fa", "PATCH"
    )
    assert main._dashboard_path_is_session_mutation_fast_path("api/sessions/bulk-delete", "POST")
    assert main._dashboard_path_is_session_mutation_fast_path("api/sessions/empty", "DELETE")
    assert not main._dashboard_path_is_session_mutation_fast_path("api/sessions", "GET")
    assert not main._dashboard_path_is_session_mutation_fast_path(
        "api/sessions/20260803_112520_46b5fa/messages", "GET"
    )
    assert not main._dashboard_path_is_session_mutation_fast_path(
        "api/sessions/20260803_112520_46b5fa", "GET"
    )

def test_dashboard_gateway_ui_uses_fast_proxy_path():
    """Messaging, pairing, and cron must skip the start_runtime lock."""
    assert main._dashboard_path_is_gateway_ui_fast_path("api/messaging/platforms")
    assert main._dashboard_path_is_gateway_ui_fast_path("api/messaging/platforms/telegram/test")
    assert main._dashboard_path_is_gateway_ui_fast_path("api/pairing")
    assert main._dashboard_path_is_gateway_ui_fast_path("api/pairing/approve")
    assert main._dashboard_path_is_gateway_ui_fast_path("api/cron/jobs")
    assert main._dashboard_path_is_gateway_ui_fast_path("api/cron/jobs/job-1")
    assert not main._dashboard_path_is_gateway_ui_fast_path("api/config")
    assert not main._dashboard_path_is_gateway_ui_fast_path("api/sessions")

def test_dashboard_model_options_uses_catalog_fast_path():
    """GET model/options must skip awaited bridge sync + start_runtime."""
    assert main._dashboard_path_is_model_options("api/model/options")
    assert main._dashboard_path_is_model_options("/api/model/options")
    assert not main._dashboard_path_is_model_options("api/model/info")
    assert not main._dashboard_path_is_lightweight("api/model/options")

def test_dashboard_analytics_uses_medium_read_path():
    """Command Center usage must skip start_runtime and get a longer budget."""
    for path in (
        "api/analytics/usage",
        "api/analytics/usage?days=30",
        "/api/analytics/usage",
        "api/analytics/models",
    ):
        # Query strings are not part of the FastAPI path param, but keep the
        # bare analytics prefixes covered either way.
        bare = path.split("?", 1)[0]
        assert main._dashboard_path_is_medium_read(bare), bare
        assert main._dashboard_path_is_model_options(bare), bare
        assert not main._dashboard_path_is_lightweight(bare), bare

def test_dashboard_settings_reads_use_lightweight_path():
    """Settings hydrate GETs must skip start_runtime lock (env/config schema)."""
    for path in (
        "api/env",
        "api/config",
        "api/config/defaults",
        "api/config/schema",
        "api/model/auxiliary",
        "api/providers/oauth",
        "/api/env",
        "/api/config/defaults",
        "/api/providers/oauth",
        "/api/model/auxiliary",
    ):
        assert main._dashboard_path_is_lightweight(path), path

    assert not main._dashboard_path_is_lightweight("api/env/reload")
    # OAuth start/disconnect still need the full proxy path (writes).
    assert not main._dashboard_path_is_lightweight("api/providers/oauth/openai-codex/start")

def test_dashboard_env_put_does_not_restart_runtime(client, monkeypatch):
    payload, token = signup(client, "env-save-no-restart@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    db.execute(
        """
        UPDATE runtime_instances
        SET status = 'running',
            container_name = ?,
            dashboard_url = 'http://127.0.0.1:19119',
            dashboard_token = 'token'
        WHERE id = ?
        """,
        ("verxio-test-runtime", runtime_row["id"]),
    )
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE id = ?",
        (runtime_row["id"],),
    )
    runtime = control_plane.runtime_from_row(runtime_row)

    restarted: list[str] = []

    class _FakeManager:
        async def restart(self, rt, extra_env=None):
            restarted.append(rt.id)
            return rt

        async def start(self, rt, extra_env=None, wait_ready=True):
            return rt

    async def fake_token(*_a, **_k):
        return "token"

    async def fake_bridge(*_a, **_k):
        return None

    class _FakeUpstream:
        status_code = 200
        content = b'{"ok":true}'
        headers = {"content-type": "application/json"}

    class _FakeClient:
        def __init__(self, *args, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return False

        async def request(self, *args, **kwargs):
            return _FakeUpstream()

    monkeypatch.setattr(main, "get_runtime_manager", lambda *_a, **_k: _FakeManager())
    async def _runtime_for_user(_user, *_a, **_k):
        return runtime

    monkeypatch.setattr(main, "aget_runtime_for_user", _runtime_for_user)
    monkeypatch.setattr(main, "runtime_env_for_user", lambda _user_id: {"GEMINI_API_KEY": "hosted"})
    monkeypatch.setattr(main, "runtime_dashboard_base_url", lambda _runtime, ensure_network=False: "http://127.0.0.1:19119")
    monkeypatch.setattr(main, "_runtime_dashboard_token_async", fake_token)
    monkeypatch.setattr(main, "_sync_composio_bridge_for_user", fake_bridge)
    monkeypatch.setattr(main, "_sync_inference_bridge_for_user", fake_bridge)
    monkeypatch.setattr(main.httpx, "AsyncClient", _FakeClient)

    response = client.put(
        "/api/runtime/dashboard/api/env",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"key": "DASHSCOPE_API_KEY", "value": "user-dashscope"},
    )

    assert response.status_code == 200
    assert restarted == []

def test_transcription_catalog_uses_fallback_without_keys(client):
    _payload, token = signup(client, "transcription-catalog@example.com")

    response = client.get("/api/transcription/catalog", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    body = response.json()
    groq = next(provider for provider in body["providers"] if provider["id"] == "groq")
    assert groq["configured"] is False
    assert groq["envKey"] == "GROQ_API_KEY"
    assert groq["source"] == "fallback"
    assert groq["recommendedModel"] == "whisper-large-v3-turbo"
    assert [model["id"] for model in groq["models"]][:2] == ["whisper-large-v3-turbo", "whisper-large-v3"]
    fishaudio = next(provider for provider in body["providers"] if provider["id"] == "fishaudio")
    assert fishaudio["configured"] is False
    assert fishaudio["envKey"] == "FISH_AUDIO_API_KEY"
    assert fishaudio["docsUrl"] == "https://fish.audio/app/api-keys"
    assert fishaudio["recommendedModel"] == "fish-audio-asr-beta"
    assert [model["id"] for model in fishaudio["models"]] == ["fish-audio-asr-beta"]

def test_transcription_catalog_keeps_fishaudio_models_static(client, monkeypatch):
    payload, token = signup(client, "transcription-fishaudio@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    env_path = Path(str(runtime_row["hermes_home_path"])) / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("FISH_AUDIO_API_KEY=fish-secret\n", encoding="utf-8")

    async def fail_for_fishaudio(_client, spec, _api_key, _env):
        if spec.id == "fishaudio":
            raise AssertionError("Fish Audio does not expose a models API")
        return []

    monkeypatch.setattr(transcription_catalog, "_fetch_provider_models", fail_for_fishaudio)

    response = client.get("/api/transcription/catalog?refresh=true", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    fishaudio = next(provider for provider in response.json()["providers"] if provider["id"] == "fishaudio")
    assert fishaudio["configured"] is True
    assert fishaudio["source"] == "fallback"
    assert fishaudio["error"] is None
    assert "fish-secret" not in response.text

def test_transcription_catalog_fetches_live_models_with_runtime_key(client, monkeypatch):
    payload, token = signup(client, "transcription-live@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    env_path = Path(str(runtime_row["hermes_home_path"])) / ".env"
    env_path.parent.mkdir(parents=True, exist_ok=True)
    env_path.write_text("VOICE_TOOLS_OPENAI_KEY=op-secret\n", encoding="utf-8")

    async def fake_fetch_provider_models(_client, spec, api_key, _env):
        assert api_key == "op-secret"
        if spec.id == "openai":
            return ["gpt-4o-mini-transcribe", "gpt-new-transcribe"]
        return []

    monkeypatch.setattr(transcription_catalog, "_fetch_provider_models", fake_fetch_provider_models)

    response = client.get("/api/transcription/catalog", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    openai = next(provider for provider in response.json()["providers"] if provider["id"] == "openai")
    assert openai["configured"] is True
    assert openai["source"] == "provider"
    assert openai["recommendedModel"] == "gpt-4o-mini-transcribe"
    assert [model["id"] for model in openai["models"]] == ["gpt-4o-mini-transcribe", "gpt-new-transcribe"]
    assert "op-secret" not in response.text

def test_dashboard_model_paths_need_inference_sync():
    assert main._dashboard_path_needs_inference_sync("api/model/info") is True
    # Catalog reads must not trigger bridge sync (docker.sock thrash).
    assert main._dashboard_path_needs_inference_sync("/api/model/options") is False
    assert main._dashboard_path_needs_inference_sync("api/status") is False
    assert main._dashboard_path_needs_inference_sync("api/config") is False
    assert main._dashboard_path_needs_inference_sync("api/sessions") is False

def test_inference_bridge_writes_hosted_verxio_qwen_model_config(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    payload, _token = signup(client, "inference-bridge@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.configured is True
    assert status.enabled is True
    assert status.changed is True
    assert status.defaultModelId == "verxio-qwen"
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {"DASHSCOPE_API_KEY": "verxio-qwen-key"}
    config = (Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8")
    assert "provider: alibaba" in config
    assert "default: qwen3.6-plus" in config
    state = Path(runtime.hermes_home_path) / ".verxio" / "inference-runtime-bridge.json"
    assert state.is_file()
    assert "verxio-qwen-key" not in state.read_text(encoding="utf-8")

def test_inference_bridge_writes_hosted_verxio_qwen_after_explicit_settings(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    payload, token = signup(client, "inference-qwen@example.com")
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "hosted", "defaultModelId": "verxio-qwen"},
    )
    assert response.status_code == 200

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.configured is True
    assert status.enabled is True
    assert status.defaultModelId == "verxio-qwen"
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {"DASHSCOPE_API_KEY": "verxio-qwen-key"}
    config = (Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8")
    assert "provider: alibaba" in config
    assert "default: qwen3.6-plus" in config
    state = Path(runtime.hermes_home_path) / ".verxio" / "inference-runtime-bridge.json"
    assert "verxio-qwen-key" not in state.read_text(encoding="utf-8")

def test_inference_bridge_preserves_openai_tool_credentials(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    payload, _token = signup(client, "inference-legacy@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)
    hermes_home = Path(runtime.hermes_home_path)
    hermes_home.mkdir(parents=True, exist_ok=True)
    (hermes_home / ".env").write_text("OPENAI_API_KEY=legacy-verxio-gpt-key\nDASHSCOPE_API_KEY=keep\n", encoding="utf-8")
    (hermes_home / "auth.json").write_text(
        json.dumps(
            {
                "version": 1,
                "providers": {},
                "active_provider": "openai-api",
                "credential_pool": {
                    "openai-api": [
                        {
                            "id": "legacy",
                            "label": "OPENAI_API_KEY",
                            "auth_type": "api_key",
                            "source": "env:OPENAI_API_KEY",
                        }
                    ],
                    "openai-codex": [
                        {
                            "id": "keep",
                            "label": "device_code",
                            "auth_type": "oauth",
                            "source": "device_code",
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.changed is True
    env_text = (hermes_home / ".env").read_text(encoding="utf-8")
    assert "OPENAI_API_KEY=legacy-verxio-gpt-key" in env_text
    assert "DASHSCOPE_API_KEY=keep" in env_text
    auth = json.loads((hermes_home / "auth.json").read_text(encoding="utf-8"))
    assert "openai-api" in auth.get("credential_pool", {})
    # Hosted sync must not leave a BYOK/OAuth active_provider pointer that
    # steals resolve_provider('auto') when config.yaml model is briefly empty.
    assert not str(auth.get("active_provider") or "").strip()
    assert "openai-codex" in auth.get("credential_pool", {})

def test_inference_bridge_clears_openai_codex_active_provider(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "verxio-gemini-key")
    payload, token = signup(client, "inference-clear-codex@example.com")
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "hosted", "defaultModelId": "verxio-gemini"},
    )
    assert response.status_code == 200

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)
    hermes_home = Path(runtime.hermes_home_path)
    hermes_home.mkdir(parents=True, exist_ok=True)
    (hermes_home / "auth.json").write_text(
        json.dumps(
            {
                "version": 1,
                "providers": {},
                "active_provider": "openai-codex",
                "credential_pool": {
                    "openai-codex": [
                        {
                            "id": "keep",
                            "label": "device_code",
                            "auth_type": "oauth",
                            "source": "device_code",
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.changed is True
    assert status.defaultModelId == "verxio-gemini"
    config = yaml.safe_load((hermes_home / "config.yaml").read_text(encoding="utf-8"))
    assert config["model"]["provider"] == "gemini"
    assert config["model"]["default"] == "gemini-flash-lite-latest"
    auth = json.loads((hermes_home / "auth.json").read_text(encoding="utf-8"))
    assert not str(auth.get("active_provider") or "").strip()
    assert "openai-codex" in auth.get("credential_pool", {})

def test_inference_bridge_honors_verxio_hosted_qwen_model_env(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_MODEL", "qwen3.7-max")
    payload, _token = signup(client, "inference-qwen-model-env@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.upstreamModelId == "qwen3.7-max"
    config = (Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8")
    assert "default: qwen3.7-max" in config

def test_inference_bridge_removes_stale_hosted_assignment_without_key(client):
    payload, _token = signup(client, "inference-stale-provider@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)
    config_path = Path(runtime.hermes_home_path) / "config.yaml"
    config_path.parent.mkdir(parents=True, exist_ok=True)
    config_path.write_text(
        "model:\n  provider: alibaba\n  default: qwen3.6-plus\nterminal:\n  cwd: /workspace\n",
        encoding="utf-8",
    )

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    config = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    assert status.configured is False
    assert status.changed is True
    assert config.get("model") is None
    assert config["terminal"]["cwd"] == "/workspace"

def test_inference_bridge_writes_hosted_verxio_gemini_model_config(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "verxio-gemini-key")
    payload, token = signup(client, "inference-gemini-bridge@example.com")
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "hosted", "defaultModelId": "verxio-gemini"},
    )
    assert response.status_code == 200

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.configured is True
    assert status.enabled is True
    assert status.defaultModelId == "verxio-gemini"
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {
        "GEMINI_API_KEY": "verxio-gemini-key",
        "GOOGLE_API_KEY": "verxio-gemini-key",
    }
    config = (Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8")
    assert "provider: gemini" in config
    assert "default: gemini-flash-lite-latest" in config
    state = Path(runtime.hermes_home_path) / ".verxio" / "inference-runtime-bridge.json"
    assert state.is_file()
    assert "verxio-gemini-key" not in state.read_text(encoding="utf-8")

def test_inference_bridge_honors_verxio_hosted_gemini_model_env(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "verxio-gemini-key")
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_MODEL", "gemini-2.5-flash")
    payload, token = signup(client, "inference-gemini-model-env@example.com")
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "hosted", "defaultModelId": "verxio-gemini"},
    )
    assert response.status_code == 200

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.upstreamModelId == "gemini-2.5-flash"
    config = (Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8")
    assert "default: gemini-2.5-flash" in config

def test_inference_bridge_preserves_user_env_credentials_for_gemini(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "verxio-gemini-key")
    payload, token = signup(client, "inference-gemini-strip@example.com")
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "hosted", "defaultModelId": "verxio-gemini"},
    )
    assert response.status_code == 200

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)
    hermes_home = Path(runtime.hermes_home_path)
    hermes_home.mkdir(parents=True, exist_ok=True)
    (hermes_home / ".env").write_text(
        "DASHSCOPE_API_KEY=user-qwen-key\nGEMINI_API_KEY=user-gemini-key\nOPENAI_API_KEY=user-openai-key\n",
        encoding="utf-8",
    )
    (hermes_home / "auth.json").write_text(
        json.dumps(
            {
                "version": 1,
                "providers": {},
                "active_provider": "alibaba",
                "credential_pool": {
                    "alibaba": [
                        {
                            "id": "qwen",
                            "label": "DASHSCOPE_API_KEY",
                            "auth_type": "api_key",
                            "source": "env:DASHSCOPE_API_KEY",
                        }
                    ],
                    "gemini": [
                        {
                            "id": "gemini",
                            "label": "GEMINI_API_KEY",
                            "auth_type": "api_key",
                            "source": "env:GEMINI_API_KEY",
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.defaultModelId == "verxio-gemini"
    env_text = (hermes_home / ".env").read_text(encoding="utf-8")
    assert "DASHSCOPE_API_KEY=user-qwen-key" in env_text
    assert "GEMINI_API_KEY=user-gemini-key" in env_text
    assert "OPENAI_API_KEY=user-openai-key" in env_text
    auth = json.loads((hermes_home / "auth.json").read_text(encoding="utf-8"))
    assert "alibaba" in auth.get("credential_pool", {})
    assert "gemini" in auth.get("credential_pool", {})
    # Hosted Gemini must not leave a non-gemini active_provider pointer that
    # can steal resolve_provider('auto') when config.yaml model is briefly empty.
    assert not str(auth.get("active_provider") or "").strip()

def test_inference_bridge_keeps_byok_selection_in_hybrid_mode(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    payload, token = signup(client, "inference-byok@example.com")

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)
    hermes_home = Path(runtime.hermes_home_path)
    hermes_home.mkdir(parents=True, exist_ok=True)

    # User selected a connected OpenAI model — bridge must not overwrite it.
    (hermes_home / "config.yaml").write_text(
        "model:\n  provider: openai\n  default: gpt-5-mini\n",
        encoding="utf-8",
    )
    (hermes_home / ".env").write_text("OPENAI_API_KEY=user-byok-openai\n", encoding="utf-8")

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is True
    assert status.message == "Hybrid mode keeps the connected provider selection."
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {
        "DASHSCOPE_API_KEY": "verxio-qwen-key"
    }

    config = (hermes_home / "config.yaml").read_text(encoding="utf-8")
    assert "provider: openai" in config
    assert "default: gpt-5-mini" in config
    assert "provider: alibaba" not in config

    # Legacy mode field still accepted for API compatibility.
    response = client.put(
        "/api/inference/settings",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
        json={"mode": "byok"},
    )
    assert response.status_code == 200

def test_signup_creates_user_workspace_agent_and_runtime(client):
    payload, _token = signup(client)

    assert payload["user"]["email"] == "ada@example.com"
    assert payload["workspace"]["tenant_id"] == payload["user"]["id"]
    assert payload["profile"]["workspace_id"] == payload["workspace"]["id"]

    workspace_rows = db.fetch_all("SELECT * FROM workspaces WHERE created_by = ?", (payload["user"]["id"],))
    agent_rows = db.fetch_all("SELECT * FROM agents WHERE workspace_id = ?", (payload["workspace"]["id"],))
    runtime_rows = db.fetch_all("SELECT * FROM runtime_instances WHERE workspace_id = ?", (payload["workspace"]["id"],))
    user_row = db.fetch_one("SELECT * FROM users WHERE id = ?", (payload["user"]["id"],))

    assert user_row
    assert user_row["email_verified"] == 1
    assert len(workspace_rows) == 1
    assert len(agent_rows) == 1
    assert len(runtime_rows) == 1
    assert runtime_rows[0]["status"] == "stopped"
    assert runtime_rows[0]["hermes_home_path"].endswith("/hermes-home")
    assert runtime_rows[0]["artifact_path"].endswith("/workspace/artifacts")

def test_signup_invite_returns_configured_code(client, monkeypatch):
    monkeypatch.setenv("VERXIO_SIGNUP_INVITE_CODE", "424242")
    response = client.get("/api/auth/signup-invite")
    assert response.status_code == 200
    assert response.json() == {"invite_code": "424242"}

def test_signup_requires_valid_invite_code(client):
    missing = client.post(
        "/api/auth/signup",
        json={"email": "no-invite@example.com", "name": "No Invite", "password": "password-123"},
    )
    assert missing.status_code == 422

    wrong = client.post(
        "/api/auth/signup",
        json={
            "email": "wrong-invite@example.com",
            "invite_code": "00000",
            "name": "Wrong Invite",
            "password": "password-123",
        },
    )
    assert wrong.status_code == 403
    assert wrong.json()["detail"] == "Invite code is invalid."
    assert db.fetch_one("SELECT * FROM users WHERE email = ?", ("wrong-invite@example.com",)) is None

def test_runtime_volume_files_survive_runtime_record_recreation(client):
    payload, _token = signup(client, "persistent-runtime@example.com")
    workspace, agent, runtime = control_plane.ensure_personal_workspace(payload["user"])
    control_plane.ensure_runtime_directories(runtime)

    artifact_file = Path(runtime.artifact_path) / "saved-report.csv"
    memory_file = Path(runtime.hermes_home_path) / "memories" / "customer-note.md"
    workspace_file = Path(runtime.workspace_path) / "workspace-summary.md"
    artifact_file.write_text("metric,value\nrevenue,100\n", encoding="utf-8")
    memory_file.parent.mkdir(parents=True, exist_ok=True)
    memory_file.write_text("Remember the customer prefers weekly reports.\n", encoding="utf-8")
    workspace_file.write_text("# Workspace summary\n\nPersistent across deploys.\n", encoding="utf-8")

    original_paths = (runtime.hermes_home_path, runtime.workspace_path, runtime.artifact_path)
    assert {record.file_name for record in runtime_manager.index_artifacts(runtime)} >= {
        "saved-report.csv",
        "workspace-summary.md",
    }

    db.execute("DELETE FROM artifacts WHERE workspace_id = ? AND agent_id = ?", (workspace.id, agent.id))
    db.execute("DELETE FROM runtime_instances WHERE id = ?", (runtime.id,))

    restored = control_plane.ensure_runtime_instance(workspace, agent)
    control_plane.ensure_runtime_directories(restored)

    assert (restored.hermes_home_path, restored.workspace_path, restored.artifact_path) == original_paths
    assert artifact_file.read_text(encoding="utf-8") == "metric,value\nrevenue,100\n"
    assert memory_file.read_text(encoding="utf-8") == "Remember the customer prefers weekly reports.\n"
    assert workspace_file.read_text(encoding="utf-8").startswith("# Workspace summary")
    assert {record.file_name for record in runtime_manager.index_artifacts(restored)} >= {
        "saved-report.csv",
        "workspace-summary.md",
    }

def test_signup_requires_email_code_before_session_or_workspace(client):
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "verify@example.com",
            "invite_code": "97685",
            "name": "Verify",
            "password": "password-123",
        },
    )

    assert response.status_code == 200
    assert response.cookies.get(SESSION_COOKIE) is None
    assert response.json()["purpose"] == "email_verify"

    user_row = db.fetch_one("SELECT * FROM users WHERE email = ?", ("verify@example.com",))
    assert user_row
    assert user_row["email_verified"] == 0
    assert db.fetch_all("SELECT * FROM workspaces WHERE created_by = ?", (user_row["id"],)) == []

    code = latest_auth_code("verify@example.com", "email_verify")
    code_row = db.fetch_one("SELECT * FROM auth_codes WHERE email = ?", ("verify@example.com",))
    assert code_row
    assert code_row["code_hash"] != code

    verify = client.post("/api/auth/verify-email", json={"email": "verify@example.com", "code": code})
    assert verify.status_code == 200
    assert verify.cookies.get(SESSION_COOKIE)

def test_login_creates_turso_backed_session(client):
    payload, _signup_token = signup(client, "login@example.com")
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    response = client.post(
        "/api/auth/login",
        json={"email": "login@example.com", "password": "password-123"},
    )

    assert response.status_code == 200
    assert response.cookies.get(SESSION_COOKIE)
    session_rows = db.fetch_all("SELECT * FROM sessions WHERE user_id = ?", (payload["user"]["id"],))
    assert len(session_rows) == 1

def test_session_expiry_slides_and_cookie_is_reissued(client):
    from datetime import timedelta

    from app import auth as auth_mod
    from app.models import utc_now

    payload, token = signup(client, "slide@example.com")
    token_hash = auth_mod.hash_session_token(token)

    # Fresh session: no renewal, no Set-Cookie on a plain authenticated request.
    fresh = client.get("/api/auth/me")
    assert fresh.status_code == 200
    assert fresh.cookies.get(SESSION_COOKIE) is None

    # Age the session past the renewal threshold (over half of its lifetime used).
    nearly = (utc_now() + timedelta(hours=6)).isoformat()
    db.execute("UPDATE sessions SET expires_at = ? WHERE token_hash = ?", (nearly, token_hash))
    auth_mod._invalidate_session_user(token_hash)

    renewed = client.get("/api/auth/me")
    assert renewed.status_code == 200
    assert renewed.cookies.get(SESSION_COOKIE) == token

    row = db.fetch_one("SELECT expires_at FROM sessions WHERE token_hash = ?", (token_hash,))
    assert row is not None
    assert str(row["expires_at"]) > nearly
    assert db.fetch_one("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", (payload["user"]["id"],))["n"] == 1

def test_password_login_for_unverified_user_resends_verification_code(client):
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "unverified@example.com",
            "invite_code": "97685",
            "name": "Unverified",
            "password": "password-123",
        },
    )
    assert response.status_code == 200

    login_response = client.post(
        "/api/auth/login",
        json={"email": "unverified@example.com", "password": "password-123"},
    )

    assert login_response.status_code == 403
    assert "Verify your email" in login_response.json()["detail"]
    assert latest_auth_code("unverified@example.com", "email_verify")

def test_login_with_one_time_code(client):
    payload, _signup_token = signup(client, "code-login@example.com")
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    challenge = client.post("/api/auth/login/code/request", json={"email": "code-login@example.com"})
    assert challenge.status_code == 200
    assert challenge.json()["purpose"] == "login"

    verify = client.post(
        "/api/auth/login/code/verify",
        json={"email": "code-login@example.com", "code": latest_auth_code("code-login@example.com", "login")},
    )

    assert verify.status_code == 200
    assert verify.cookies.get(SESSION_COOKIE)
    assert verify.json()["user"]["id"] == payload["user"]["id"]

def test_forgot_password_code_resets_password_and_logs_in(client):
    payload, _signup_token = signup(client, "reset@example.com")
    old_hash = db.fetch_one("SELECT password_hash FROM users WHERE id = ?", (payload["user"]["id"],))["password_hash"]
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    challenge = client.post("/api/auth/password/forgot", json={"email": "reset@example.com"})
    assert challenge.status_code == 200
    assert challenge.json()["purpose"] == "password_reset"

    reset = client.post(
        "/api/auth/password/reset",
        json={
            "email": "reset@example.com",
            "code": latest_auth_code("reset@example.com", "password_reset"),
            "password": "new-password-123",
        },
    )

    assert reset.status_code == 200
    assert reset.cookies.get(SESSION_COOKIE)
    assert reset.json()["user"]["id"] == payload["user"]["id"]
    new_hash = db.fetch_one("SELECT password_hash FROM users WHERE id = ?", (payload["user"]["id"],))["password_hash"]
    assert new_hash != old_hash

    client.post("/api/auth/logout")
    old_login = client.post("/api/auth/login", json={"email": "reset@example.com", "password": "password-123"})
    new_login = client.post("/api/auth/login", json={"email": "reset@example.com", "password": "new-password-123"})

    assert old_login.status_code == 401
    assert new_login.status_code == 200

def test_notepad_recording_upload_saves_audio_as_artifact(client):
    payload, token = signup(client, "recording-artifact@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}
    audio_bytes = b"verxio-recording"
    data_url = f"data:audio/webm;base64,{base64.b64encode(audio_bytes).decode('ascii')}"

    response = client.post(
        "/api/notepad/recordings",
        json={
            "file_name": "../Weekly Planning?.wav",
            "data_url": data_url,
            "mime_type": "audio/webm",
        },
        headers=headers,
    )

    assert response.status_code == 200
    artifact = response.json()["artifact"]
    assert artifact["file_name"] == "Weekly Planning.webm"
    assert artifact["relative_path"] == "notepad-recordings/Weekly Planning.webm"
    assert artifact["content_type"] in {"audio/webm", "video/webm"}
    assert artifact["size_bytes"] == len(audio_bytes)

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (payload["workspace"]["id"], payload["profile"]["id"]),
    )
    assert runtime_row
    saved = Path(str(runtime_row["artifact_path"])) / artifact["relative_path"]
    assert saved.read_bytes() == audio_bytes

def test_notepad_recording_stores_on_device_when_runtime_path_is_unwritable(client, monkeypatch, tmp_path):
    payload, token = signup(client, "recording-device@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}
    device = tmp_path / "Verxio"
    device.mkdir()
    blocked = tmp_path / "blocked"
    blocked.mkdir()
    blocked.chmod(0o500)
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (payload["workspace"]["id"], payload["profile"]["id"]),
    )
    assert runtime_row
    db.execute(
        """
        UPDATE runtime_instances
        SET workspace_path = ?, artifact_path = ?
        WHERE id = ?
        """,
        (str(blocked / "workspace"), str(blocked / "artifacts"), runtime_row["id"]),
    )
    control_plane._invalidate_context_cache()
    monkeypatch.setattr("app.control_plane.desktop_workspace_dir", lambda: device)

    audio_bytes = b"verxio-local-recording"
    data_url = f"data:audio/webm;base64,{base64.b64encode(audio_bytes).decode('ascii')}"

    try:
        response = client.post(
            "/api/notepad/recordings",
            json={
                "file_name": "Weekly Planning",
                "data_url": data_url,
                "mime_type": "audio/webm",
            },
            headers=headers,
        )
    finally:
        blocked.chmod(0o700)

    assert response.status_code == 200
    artifact = response.json()["artifact"]
    assert artifact["relative_path"] == "recording/Weekly Planning.webm"
    saved = device / "artifacts" / "recording" / "Weekly Planning.webm"
    assert saved.read_bytes() == audio_bytes

def test_notepad_notes_folders_and_public_shares(client):
    _payload, token = signup(client, "notes@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    folder = client.post("/api/notepad/folders", json={"name": "User interviews"}, headers=headers)
    assert folder.status_code == 200
    folder_id = folder.json()["id"]

    note = client.post(
        "/api/notepad/notes",
        json={
            "folder_id": folder_id,
            "title": "Acme discovery call",
            "content": "Follow up with pricing.",
            "transcript": "Buyer: We need SOC2.",
            "summary": "Acme needs security proof before rollout.",
            "meeting_type": "sales",
        },
        headers=headers,
    )
    assert note.status_code == 200
    note_id = note.json()["id"]

    moved = client.patch(
        f"/api/notepad/notes/{note_id}",
        json={"folder_id": None, "content": "Follow up with pricing and SOC2."},
        headers=headers,
    )
    assert moved.status_code == 200
    assert moved.json()["folder_id"] is None
    assert "SOC2" in moved.json()["content"]

    listing = client.get("/api/notepad", headers=headers)
    assert listing.status_code == 200
    assert listing.json()["folders"][0]["name"] == "User interviews"
    assert listing.json()["notes"][0]["title"] == "Acme discovery call"

    summary = client.post(f"/api/notepad/notes/{note_id}/summarize", headers=headers)
    assert summary.status_code == 200
    generated_summary = summary.json()["summary"]
    assert generated_summary
    assert summary.json()["source"] == "hermes-summary"

    share = client.post(f"/api/notepad/notes/{note_id}/share", headers=headers)
    assert share.status_code == 200
    share_payload = share.json()
    assert share_payload["url"].endswith(f"/share/notepad/{share_payload['token']}")

    public = client.get(f"/api/public/notepad/{share_payload['token']}")
    assert public.status_code == 200
    assert public.json()["note"]["summary"] == generated_summary
    assert public.json()["workspace_name"]

    revoke = client.delete(f"/api/notepad/notes/{note_id}/share", headers=headers)
    assert revoke.status_code == 200
    assert client.get(f"/api/public/notepad/{share_payload['token']}").status_code == 404

def test_notepad_content_update_mirrors_summary_when_summary_was_content(client):
    """Agent-style content-only PATCH should refresh a mirrored summary pane."""
    _payload, token = signup(client, "notes-mirror@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    note = client.post(
        "/api/notepad/notes",
        json={
            "title": "Playbook",
            "content": "Version one body.",
            "summary": "Version one body.",
        },
        headers=headers,
    )
    assert note.status_code == 200
    note_id = note.json()["id"]

    updated = client.patch(
        f"/api/notepad/notes/{note_id}",
        json={"content": "Version two body with edits."},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["content"] == "Version two body with edits."
    assert updated.json()["summary"] == "Version two body with edits."

    # Independently authored summaries must not be clobbered by content-only PATCH.
    authored = client.patch(
        f"/api/notepad/notes/{note_id}",
        json={"summary": "Deep authored summary about version two."},
        headers=headers,
    )
    assert authored.status_code == 200
    preserved = client.patch(
        f"/api/notepad/notes/{note_id}",
        json={"content": "Version three body."},
        headers=headers,
    )
    assert preserved.status_code == 200
    assert preserved.json()["content"] == "Version three body."
    assert preserved.json()["summary"] == "Deep authored summary about version two."

def test_notepad_share_promotes_content_into_empty_summary(client):
    _payload, token = signup(client, "share-fallback@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    note = client.post(
        "/api/notepad/notes",
        json={
            "title": "Playbook only in notes",
            "content": "# Hook\n\nShip daily. Own the audience.",
            "summary": "",
        },
        headers=headers,
    )
    assert note.status_code == 200
    note_id = note.json()["id"]
    assert note.json()["summary"] == ""

    share = client.post(f"/api/notepad/notes/{note_id}/share", headers=headers)
    assert share.status_code == 200
    assert "Ship daily" in share.json()["note"]["summary"]

    public = client.get(f"/api/public/notepad/{share.json()['token']}")
    assert public.status_code == 200
    assert "Ship daily" in public.json()["note"]["summary"]

def test_notepad_runtime_bearer_token_can_list_and_share(client):
    """Hermes containers auth to Notepad with the runtime dashboard token."""
    payload, token = signup(client, "runtime-notes@example.com")
    cookie_headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    note = client.post(
        "/api/notepad/notes",
        json={"title": "Gateway note", "content": "From Telegram later.", "summary": "Short summary."},
        headers=cookie_headers,
    )
    assert note.status_code == 200
    note_id = note.json()["id"]

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime_token = str(runtime_row.get("dashboard_token") or "")
    if not runtime_token:
        runtime_token = "test-runtime-token"
        db.execute(
            "UPDATE runtime_instances SET dashboard_token = ? WHERE id = ?",
            (runtime_token, runtime_row["id"]),
        )

    bearer = {"Authorization": f"Bearer {runtime_token}"}
    listing = client.get("/api/notepad", headers=bearer)
    assert listing.status_code == 200
    assert any(item["id"] == note_id for item in listing.json()["notes"])

    share = client.post(f"/api/notepad/notes/{note_id}/share", headers=bearer)
    assert share.status_code == 200
    assert share.json()["url"].endswith(f"/share/notepad/{share.json()['token']}")

    # Use a fresh client so signup cookies cannot satisfy auth.
    with TestClient(app) as anon:
        assert anon.get("/api/notepad").status_code == 401
        assert anon.get("/api/notepad", headers={"Authorization": "Bearer wrong"}).status_code == 401

def test_notepad_device_token_can_list_and_share(client):
    """Desktop Hermes uses a device token for the same Notepad and share URL."""
    _payload, token = signup(client, "desktop-notes@example.com")
    cookie_headers = {"Cookie": f"{SESSION_COOKIE}={token}"}
    note = client.post(
        "/api/notepad/notes",
        json={"title": "Desktop note", "content": "From the desktop agent.", "summary": "Desktop summary."},
        headers=cookie_headers,
    )
    assert note.status_code == 200
    created = client.post(
        "/api/auth/device",
        json={"name": "Verxio Desktop", "platform": "desktop"},
        headers=cookie_headers,
    )
    assert created.status_code == 200
    device_token = created.json()["token"]

    with TestClient(app) as anon:
        bearer = {"Authorization": f"Bearer {device_token}"}
        listing = anon.get("/api/notepad", headers=bearer)
        assert listing.status_code == 200
        assert any(item["id"] == note.json()["id"] for item in listing.json()["notes"])
        share = anon.post(f"/api/notepad/notes/{note.json()['id']}/share", headers=bearer)
        assert share.status_code == 200
        assert share.json()["url"].endswith(f"/share/notepad/{share.json()['token']}")

def test_notepad_summarize_uses_runtime_dashboard(client, monkeypatch):
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "auto")

    async def fake_run_agent_via_dashboard(workspace, profile, user_input, *, instructions=None):
        assert "Acme discovery call" in user_input
        assert "in-depth summary" in user_input.lower()
        assert "concise" not in user_input.lower()
        assert "Detailed walkthrough" in user_input
        return "## Overview\n\nBuyer needs SOC2.\n\n## Decisions\n- Follow up on SOC2."

    monkeypatch.setattr("app.notepad.run_agent_via_dashboard", fake_run_agent_via_dashboard)

    _payload, token = signup(client, "dashboard-notes@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    note = client.post(
        "/api/notepad/notes",
        json={
            "title": "Acme discovery call",
            "content": "Follow up with pricing.",
            "transcript": "Buyer: We need SOC2.",
        },
        headers=headers,
    )
    note_id = note.json()["id"]

    summary = client.post(f"/api/notepad/notes/{note_id}/summarize", headers=headers)
    assert summary.status_code == 200
    assert "SOC2" in summary.json()["summary"]
    assert summary.json()["source"] == "hermes-summary"

def test_notepad_notes_are_workspace_isolated(client):
    _user_one, token_one = signup(client, "notes-one@example.com")
    _user_two, token_two = signup(client, "notes-two@example.com")

    note = client.post(
        "/api/notepad/notes",
        json={"title": "Private note"},
        headers={"Cookie": f"{SESSION_COOKIE}={token_one}"},
    )
    assert note.status_code == 200
    note_id = note.json()["id"]

    user_two_list = client.get("/api/notepad", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})
    assert user_two_list.status_code == 200
    assert user_two_list.json()["notes"] == []

    blocked = client.patch(
        f"/api/notepad/notes/{note_id}",
        json={"title": "Stolen"},
        headers={"Cookie": f"{SESSION_COOKIE}={token_two}"},
    )
    assert blocked.status_code == 404

def test_composio_catalog_uses_authenticated_workspace_contract(client, monkeypatch):
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    _payload, token = signup(client, "composio@example.com")

    apps = client.get("/api/composio/connections/apps", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    tools = client.get("/api/composio/connections/apps/gmail/tools", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    accounts = client.get("/api/composio/connections", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    initiate = client.post(
        "/api/composio/connections/initiate",
        json={"appSlug": "gmail"},
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert apps.status_code == 200
    assert tools.status_code == 200
    assert accounts.status_code == 200
    assert apps.json()["configured"] is False
    assert apps.json()["catalogReady"] is False
    assert accounts.json() == {
        "accounts": [],
        "configured": False,
        "toolBridge": {
            "changed": False,
            "configured": False,
            "connectedApps": [],
            "enabled": False,
            "message": "Composio is not configured.",
            "serverName": "composio",
        },
    }
    assert len(apps.json()["apps"]) == 15
    assert apps.json()["apps"][0]["slug"] == "gmail"
    assert tools.json()["configured"] is False
    assert tools.json()["tools"][0]["slug"] == "GMAIL_SEARCH_EMAILS"
    assert initiate.status_code == 500
    assert initiate.json()["detail"] == "Composio is not configured."

def test_composio_connections_load_when_runtime_home_is_unwritable(client, monkeypatch, tmp_path):
    monkeypatch.delenv("COMPOSIO_API_KEY", raising=False)
    payload, token = signup(client, "composio-desktop@example.com")
    blocked = tmp_path / "blocked"
    blocked.mkdir()
    blocked.chmod(0o500)
    desktop = tmp_path / "hermes-home"
    monkeypatch.setattr("app.control_plane.desktop_hermes_home", lambda: desktop)
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (payload["workspace"]["id"], payload["profile"]["id"]),
    )
    assert runtime_row
    db.execute(
        "UPDATE runtime_instances SET hermes_home_path = ? WHERE id = ?",
        (str(blocked / "hermes-home"), runtime_row["id"]),
    )
    control_plane._invalidate_context_cache()

    try:
        apps = client.get("/api/composio/connections/apps", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
        accounts = client.get("/api/composio/connections", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    finally:
        blocked.chmod(0o700)

    assert apps.status_code == 200
    assert accounts.status_code == 200
    assert len(apps.json()["apps"]) == 15
    assert accounts.json()["accounts"] == []
    assert desktop.is_dir()

def test_composio_bridge_writes_runtime_mcp_server(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    payload, _token = signup(client, "composio-bridge@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    calls: list[dict] = []

    def fake_post(url: str, body: dict, timeout: int = 30):
        assert url.endswith("/tool_router/session")
        calls.append(body)
        return {"id": "session_123", "mcp": {"url": "https://mcp.composio.dev/session_123"}}

    monkeypatch.setattr(composio_catalog, "_post", fake_post)

    status = composio_catalog.sync_composio_runtime_bridge(
        runtime,
        payload["user"]["id"],
        [ComposioConnectedAccount(appSlug="gmail", id="ca_gmail", status="ACTIVE")],
    )

    assert status.enabled is True
    assert status.changed is True
    assert status.connectedApps == ["gmail"]
    assert calls[0]["connected_accounts"] == {"gmail": ["ca_gmail"]}
    assert calls[0]["toolkits"] == {"enable": ["gmail"]}
    assert "preload" not in calls[0]

    config_path = Path(runtime.hermes_home_path) / "config.yaml"
    config = config_path.read_text(encoding="utf-8")
    assert "mcp_servers:" in config
    assert "composio:" in config
    assert "https://mcp.composio.dev/session_123" in config
    assert "${COMPOSIO_API_KEY}" in config
    assert "## Verxio Connected Apps" in config
    assert "Gmail" in config and "`gmail`" in config
    assert "/opt/data/google_token.json" in config
    assert "source of truth for Verxio" in config
    assert "only working path" in config
    assert "ALWAYS execute with `mcp_composio_COMPOSIO_MULTI_EXECUTE_TOOL`" in config
    assert "Never call those slugs via Hermes `tool_call`" in config
    assert "stringified JSON blob" in config
    assert "Google Docs long-content" in config
    assert "or the discovered `mcp_composio_*` tool" not in config

def test_composio_accounts_use_current_api_and_parse_auth_config_toolkit(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    monkeypatch.setenv("COMPOSIO_API_BASE_URL", "https://legacy.example/api/v3")
    monkeypatch.setenv("COMPOSIO_TOOLS_API_BASE_URL", "https://current.example/api/v3.1")

    calls: list[tuple[str, str, dict]] = []

    def fake_get(base_url: str, path: str, params=None, timeout: int = 30):
        calls.append((base_url, path, params or {}))
        assert base_url == "https://current.example/api/v3.1"
        assert path == "/connected_accounts"
        assert params["user_ids"] == ["user_123"]
        assert params["statuses"] == ["ACTIVE"]
        return {
            "items": [
                {
                    "auth_config": {"toolkit": {"slug": "gmail"}},
                    "created_at": "2026-07-17T00:00:00Z",
                    "id": "ca_gmail",
                    "state": {"val": {"status": "ACTIVE"}},
                }
            ]
        }

    monkeypatch.setattr(composio_catalog, "_get", fake_get)

    accounts = composio_catalog.list_composio_accounts("user_123")

    assert len(accounts) == 1
    assert accounts[0].appSlug == "gmail"
    assert accounts[0].id == "ca_gmail"
    assert accounts[0].status == "ACTIVE"
    assert calls == [
        (
            "https://current.example/api/v3.1",
            "/connected_accounts",
            {"user_ids": ["user_123"], "statuses": ["ACTIVE"], "limit": 1000},
        )
    ]

def test_composio_trigger_catalog_uses_current_api_and_preserves_config_schema(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    calls: list[tuple[str, str, dict]] = []

    def fake_get(base_url: str, path: str, params=None, timeout: int = 30):
        calls.append((base_url, path, params or {}))
        return {
            "items": [
                {
                    "slug": "GITHUB_COMMIT_EVENT",
                    "name": "New commit",
                    "description": "Runs when a commit is pushed.",
                    "instructions": "Choose a repository.",
                    "type": "webhook",
                    "toolkit": {"slug": "github"},
                    "config": {
                        "type": "object",
                        "properties": {"owner": {"type": "string", "title": "Owner"}},
                        "required": ["owner"],
                    },
                    "payload": {"type": "object"},
                }
            ]
        }

    monkeypatch.setattr(composio_catalog, "_get", fake_get)

    result = composio_catalog.list_composio_trigger_types("github")

    assert result.configured is True
    assert result.triggers[0].slug == "GITHUB_COMMIT_EVENT"
    assert result.triggers[0].config["required"] == ["owner"]
    assert calls == [
        (
            "https://backend.composio.dev/api/v3.1",
            "/triggers_types",
            {"limit": 100, "toolkit_slugs": ["github"]},
        )
    ]

def test_composio_delivery_tools_preserve_input_schema(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")

    def fake_get(base_url: str, path: str, params=None, timeout: int = 30):
        assert base_url == "https://backend.composio.dev/api/v3.1"
        assert path == "/tools"
        return {
            "items": [
                {
                    "slug": "GMAIL_SEND_EMAIL",
                    "name": "Send email",
                    "description": "Send a Gmail message.",
                    "input_parameters": {
                        "type": "object",
                        "required": ["recipient_email"],
                        "properties": {
                            "recipient_email": {"type": "string", "title": "Recipient email"},
                            "subject": {"type": "string", "title": "Subject"},
                        },
                    },
                }
            ]
        }

    monkeypatch.setattr(composio_catalog, "_get", fake_get)

    tools = composio_catalog.list_composio_app_tools("gmail", limit=100)

    assert tools[0].slug == "GMAIL_SEND_EMAIL"
    assert tools[0].inputParameters["required"] == ["recipient_email"]
    assert tools[0].inputParameters["properties"]["subject"]["type"] == "string"

def test_composio_accounts_fall_back_to_legacy_api(monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    monkeypatch.setenv("COMPOSIO_API_BASE_URL", "https://legacy.example/api/v3")
    monkeypatch.setenv("COMPOSIO_TOOLS_API_BASE_URL", "https://current.example/api/v3.1")

    calls: list[str] = []

    def fake_get(base_url: str, path: str, params=None, timeout: int = 30):
        calls.append(base_url)
        if base_url == "https://current.example/api/v3.1":
            raise RuntimeError("not found")
        return {"connected_accounts": [{"app_slug": "gmail", "id": "ca_gmail", "status": "ACTIVE"}]}

    monkeypatch.setattr(composio_catalog, "_get", fake_get)

    accounts = composio_catalog.list_composio_accounts("user_123")

    assert [account.appSlug for account in accounts] == ["gmail"]
    assert calls == ["https://current.example/api/v3.1", "https://legacy.example/api/v3"]

def test_composio_bridge_accepts_explicit_preload_allowlist(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    monkeypatch.setenv(
        "COMPOSIO_MCP_PRELOAD_TOOLS",
        "GOOGLESHEETS_READ_ROWS, GOOGLEDRIVE_SEARCH_FILES",
    )
    payload, _token = signup(client, "composio-preload@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    calls: list[dict] = []

    def fake_post(url: str, body: dict, timeout: int = 30):
        assert url.endswith("/tool_router/session")
        calls.append(body)
        return {"id": "session_123", "mcp": {"url": "https://mcp.composio.dev/session_123"}}

    monkeypatch.setattr(composio_catalog, "_post", fake_post)

    status = composio_catalog.sync_composio_runtime_bridge(
        runtime,
        payload["user"]["id"],
        [
            ComposioConnectedAccount(appSlug="googledrive", id="ca_drive", status="ACTIVE"),
            ComposioConnectedAccount(appSlug="googlesheets", id="ca_sheets", status="ACTIVE"),
        ],
    )

    assert status.enabled is True
    assert calls[0]["preload"] == {
        "tools": ["GOOGLESHEETS_READ_ROWS", "GOOGLEDRIVE_SEARCH_FILES"],
    }

    state_path = Path(runtime.hermes_home_path) / ".verxio" / "composio-tool-router-session.json"
    state = json.loads(state_path.read_text(encoding="utf-8"))
    assert state["preload_tools"] == ["GOOGLESHEETS_READ_ROWS", "GOOGLEDRIVE_SEARCH_FILES"]

def test_composio_connections_restart_stale_runtime_env(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    payload, token = signup(client, "composio-stale-runtime@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    db.execute(
        "UPDATE runtime_instances SET status = 'running', container_name = ? WHERE id = ?",
        ("verxio-test-runtime", runtime_row["id"]),
    )

    monkeypatch.setattr(
        main,
        "list_composio_accounts",
        lambda _user_id: [ComposioConnectedAccount(appSlug="gmail", id="ca_gmail", status="ACTIVE")],
    )
    monkeypatch.setattr(
        main,
        "sync_composio_runtime_bridge",
        lambda _runtime, _user_id, _accounts: ComposioToolBridgeStatus(
            configured=True,
            enabled=True,
            changed=False,
            connectedApps=["gmail"],
        ),
    )
    monkeypatch.setattr(main, "runtime_container_env_matches", lambda _runtime, _key, _value: False)

    restarted: list[str] = []

    class _FakeManager:
        async def restart(self, runtime, extra_env=None):
            restarted.append(runtime.id)
            return runtime

    monkeypatch.setattr(main, "get_runtime_manager", lambda *_a, **_k: _FakeManager())

    response = client.get("/api/composio/connections", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    assert restarted == [runtime_row["id"]]

def test_composio_bridge_sync_restarts_stale_runtime_env_without_apply_live(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    payload, _token = signup(client, "composio-stale-runtime-login@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    db.execute(
        "UPDATE runtime_instances SET status = 'running', container_name = ? WHERE id = ?",
        ("verxio-test-runtime", runtime_row["id"]),
    )

    monkeypatch.setattr(
        main,
        "list_composio_accounts",
        lambda _user_id: [ComposioConnectedAccount(appSlug="gmail", id="ca_gmail", status="ACTIVE")],
    )
    monkeypatch.setattr(
        main,
        "sync_composio_runtime_bridge",
        lambda _runtime, _user_id, _accounts: ComposioToolBridgeStatus(
            configured=True,
            enabled=True,
            changed=False,
            connectedApps=["gmail"],
        ),
    )
    monkeypatch.setattr(main, "runtime_container_env_matches", lambda _runtime, _key, _value: False)

    restarted: list[str] = []

    class _FakeManager:
        async def restart(self, runtime, extra_env=None):
            restarted.append(runtime.id)
            return runtime

    monkeypatch.setattr(main, "get_runtime_manager", lambda *_a, **_k: _FakeManager())

    import asyncio

    asyncio.run(main._sync_composio_bridge_for_user(payload["user"], apply_live=False))

    assert restarted == [runtime_row["id"]]

def test_composio_connection_change_soft_reloads_mcp_without_docker_restart(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    payload, token = signup(client, "composio-soft-reload@example.com")
    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    db.execute(
        """
        UPDATE runtime_instances
        SET status = 'running',
            container_name = ?,
            dashboard_url = 'http://127.0.0.1:19119',
            dashboard_token = 'token'
        WHERE id = ?
        """,
        ("verxio-test-runtime", runtime_row["id"]),
    )

    monkeypatch.setattr(
        main,
        "list_composio_accounts",
        lambda _user_id: [ComposioConnectedAccount(appSlug="turso", id="ca_turso", status="ACTIVE")],
    )
    monkeypatch.setattr(
        main,
        "sync_composio_runtime_bridge",
        lambda _runtime, _user_id, _accounts: ComposioToolBridgeStatus(
            configured=True,
            enabled=True,
            changed=True,
            connectedApps=["turso"],
        ),
    )
    monkeypatch.setattr(main, "runtime_container_env_matches", lambda _runtime, _key, _value: True)

    restarted: list[str] = []
    soft_reloads: list[str] = []

    class _FakeManager:
        async def restart(self, runtime, extra_env=None):
            restarted.append(runtime.id)
            return runtime

    async def fake_soft_reload(runtime):
        soft_reloads.append(runtime.id)
        return {"ok": True, "message": "Reloaded MCP servers (3 tool(s)).", "toolCount": 3}

    monkeypatch.setattr(main, "get_runtime_manager", lambda *_a, **_k: _FakeManager())
    monkeypatch.setattr(main, "soft_reload_runtime_mcp", fake_soft_reload)

    response = client.get("/api/composio/connections", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    assert restarted == []
    assert soft_reloads == [runtime_row["id"]]

def test_composio_setup_returns_inline_fields(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    _payload, token = signup(client, "composio-setup@example.com")

    def fake_fetch_toolkit(app_slug: str):
        if app_slug == "bigmailer":
            return {
                "slug": "bigmailer",
                "name": "BigMailer",
                "auth_schemes": ["API_KEY"],
                "composio_managed_auth_schemes": [],
            }
        return None

    def fake_resolve_custom_auth_config_id(app_slug: str, auth_scheme: str) -> str:
        assert app_slug == "bigmailer"
        assert auth_scheme == "API_KEY"
        return "ac_test_bigmailer"

    def fake_fetch_auth_config(auth_config_id: str):
        assert auth_config_id == "ac_test_bigmailer"
        return {
            "expected_input_fields": [
                {
                    "name": "generic_api_key",
                    "displayName": "BigMailer API Key",
                    "required": True,
                    "is_secret": True,
                    "description": "API key",
                }
            ]
        }

    monkeypatch.setattr(composio_catalog, "_fetch_toolkit_by_slug", fake_fetch_toolkit)
    monkeypatch.setattr(composio_catalog, "_find_existing_custom_auth_config", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(composio_catalog, "_resolve_custom_auth_config_id", fake_resolve_custom_auth_config_id)
    monkeypatch.setattr(composio_catalog, "_fetch_auth_config", fake_fetch_auth_config)

    response = client.get(
        "/api/composio/connections/apps/bigmailer/setup",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["authMode"] == "connect_link"
    assert payload["supportsInline"] is True
    assert payload["inputFields"][0]["name"] == "generic_api_key"

def test_composio_complete_accepts_credentials(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    _payload, token = signup(client, "composio-complete@example.com")

    def fake_fetch_toolkit(app_slug: str):
        return {
            "slug": "bigmailer",
            "name": "BigMailer",
            "auth_schemes": ["API_KEY"],
            "composio_managed_auth_schemes": [],
        }

    def fake_post(url: str, payload: dict, timeout: int = 30):
        assert url.endswith("/connected_accounts")
        assert "/initiate" not in url
        assert payload["auth_config"]["id"] == "ac_test"
        assert payload["connection"]["data"]["generic_api_key"] == "secret-key"
        assert payload["connection"]["user_id"]
        return {"id": "ca_test_123", "status": "ACTIVE"}

    monkeypatch.setattr(composio_catalog, "_fetch_toolkit_by_slug", fake_fetch_toolkit)
    monkeypatch.setattr(composio_catalog, "_resolve_custom_auth_config_id", lambda *_args, **_kwargs: "ac_test")
    monkeypatch.setattr(
        composio_catalog,
        "_fetch_auth_config",
        lambda _auth_config_id: {
            "expected_input_fields": [
                {
                    "name": "generic_api_key",
                    "displayName": "BigMailer API Key",
                    "required": True,
                    "is_secret": True,
                }
            ]
        },
    )
    monkeypatch.setattr(composio_catalog, "_post", fake_post)

    response = client.post(
        "/api/composio/connections/complete",
        json={"appSlug": "bigmailer", "credentials": {"generic_api_key": "secret-key"}},
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    assert response.json() == {"connectionId": "ca_test_123", "status": "ACTIVE"}

def test_composio_initiate_rejects_oauth_app_toolkit(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    _payload, token = signup(client, "composio-connect@example.com")

    def fake_fetch_toolkit(app_slug: str):
        if app_slug == "twitter":
            return {
                "slug": "twitter",
                "name": "Twitter",
                "auth_schemes": ["OAUTH2"],
                "composio_managed_auth_schemes": [],
            }
        return None

    monkeypatch.setattr(composio_catalog, "_fetch_toolkit_by_slug", fake_fetch_toolkit)
    monkeypatch.setattr(composio_catalog, "_find_existing_custom_auth_config", lambda *_args, **_kwargs: None)

    response = client.post(
        "/api/composio/connections/initiate",
        json={"appSlug": "twitter"},
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 400
    assert "oauth app" in response.json()["detail"].lower()

def test_composio_initiate_allows_oauth_app_with_custom_auth(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    _payload, token = signup(client, "composio-oauth-ready@example.com")

    def fake_fetch_toolkit(app_slug: str):
        return {
            "slug": "twitter",
            "name": "Twitter",
            "auth_schemes": ["OAUTH2"],
            "composio_managed_auth_schemes": [],
        }

    def fake_post(url: str, payload: dict, timeout: int = 30):
        assert url.endswith("/connected_accounts/link")
        assert payload["auth_config_id"] == "ac_twitter_oauth"
        return {"redirect_url": "https://composio.dev/oauth", "id": "ca_oauth_1"}

    monkeypatch.setattr(composio_catalog, "_fetch_toolkit_by_slug", fake_fetch_toolkit)
    monkeypatch.setattr(composio_catalog, "_find_existing_custom_auth_config", lambda *_args, **_kwargs: "ac_twitter_oauth")
    monkeypatch.setattr(composio_catalog, "_resolve_custom_auth_config_id", lambda *_args, **_kwargs: "ac_twitter_oauth")
    monkeypatch.setattr(composio_catalog, "_post", fake_post)

    response = client.post(
        "/api/composio/connections/initiate",
        json={"appSlug": "twitter"},
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    assert response.json()["redirectUrl"] == "https://composio.dev/oauth"

def test_composio_setup_returns_oauth_app_fields(client, monkeypatch):
    monkeypatch.setenv("COMPOSIO_API_KEY", "test-key")
    _payload, token = signup(client, "composio-oauth-setup@example.com")

    def fake_fetch_toolkit(app_slug: str):
        return {
            "slug": "twitter",
            "name": "Twitter",
            "auth_schemes": ["OAUTH2"],
            "composio_managed_auth_schemes": [],
        }

    monkeypatch.setattr(composio_catalog, "_fetch_toolkit_by_slug", fake_fetch_toolkit)
    monkeypatch.setattr(composio_catalog, "_find_existing_custom_auth_config", lambda *_args, **_kwargs: None)

    response = client.get(
        "/api/composio/connections/apps/twitter/setup",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["authMode"] == "requires_oauth_app"
    assert payload["supportsInline"] is True
    assert payload["supportsLink"] is False
    assert payload["inputFields"][0]["name"] == "client_id"

def test_runtime_start_attaches_to_the_pool_without_docker(client, monkeypatch):
    payload, token = signup(client, "runtime@example.com")
    calls: list[list[str]] = []

    def fake_docker(args: list[str]) -> CompletedProcess[str]:
        calls.append(args)
        return CompletedProcess(args, 1, "", "docker is not used")

    async def fake_health(_runtime):
        return True, "Hermes dashboard is reachable."

    monkeypatch.setattr(main, "runtime_health", fake_health)
    monkeypatch.setattr("app.runtime_manager._run_docker", fake_docker)
    monkeypatch.setattr("app.runtime_orch.pool._attach_timeout_seconds", lambda: 0)

    response = client.post("/api/runtime/start", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["runtime"]["status"] == "starting"
    assert body["runtime"]["manager"] == "pool"
    assert not body["runtime"].get("container_id")
    assert calls == []

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    assert runtime_row["manager"] == "pool"
    assert runtime_row["dashboard_token"]

def _runtime_for_health(**overrides) -> RuntimeInstance:
    data = {
        "id": "rt_health",
        "tenant_id": "tenant",
        "workspace_id": "workspace",
        "agent_id": "agent",
        "mode": "local-docker",
        "status": "starting",
        "container_name": "verxio-health-test",
        "dashboard_url": "http://runtime.local:9119",
        "hermes_home_path": "/tmp/home",
        "workspace_path": "/tmp/workspace",
        "artifact_path": "/tmp/artifacts",
    }
    data.update(overrides)
    return RuntimeInstance(**data)

def test_gateway_status_normalizes_optional_unpaired_whatsapp():
    payload = {
        "gateway_running": True,
        "gateway_platforms": {
            "slack": {"state": "connected", "updated_at": "2026-07-13T00:00:00Z"},
            "whatsapp": {
                "state": "fatal",
                "configured": True,
                "enabled": True,
                "error_code": "whatsapp_not_paired",
                "error_message": "WhatsApp is enabled but not paired.",
                "updated_at": "2026-07-13T00:00:00Z",
            },
        },
    }

    normalized = runtime_manager.normalize_gateway_status_payload(payload)

    assert normalized["gateway_platforms"]["slack"]["state"] == "connected"
    assert normalized["gateway_platforms"]["whatsapp"]["state"] == "not_configured"
    assert normalized["gateway_platforms"]["whatsapp"]["configured"] is False
    assert normalized["gateway_platforms"]["whatsapp"]["enabled"] is False
    assert normalized["gateway_platforms"]["whatsapp"]["error_code"] is None
    assert normalized["gateway_platforms"]["whatsapp"]["error_message"] is None

def test_gateway_status_normalizes_top_level_optional_unpaired_whatsapp_exit_reason():
    payload = {
        "gateway_running": False,
        "gateway_state": "startup_failed",
        "gateway_exit_reason": "whatsapp: WhatsApp enabled but not paired — run `hermes whatsapp` to pair.",
        "gateway_platforms": {},
    }

    normalized = runtime_manager.normalize_gateway_status_payload(payload)

    assert normalized["gateway_running"] is True
    assert normalized["gateway_state"] == "ready"
    assert normalized["gateway_exit_reason"] is None
    assert "Hermes" not in json.dumps(normalized)

def test_runtime_health_uses_recent_success_cache(monkeypatch):
    runtime = _runtime_for_health(status="running", container_name="verxio-health-cache")
    runtime_manager.mark_runtime_healthy(runtime, ttl=60)

    class FailingClient:
        def __init__(self, *args, **kwargs):
            raise AssertionError("runtime_health should not hit the network while the healthy cache is fresh")

    monkeypatch.setattr(runtime_manager.httpx, "AsyncClient", FailingClient)

    connected, detail = asyncio.run(runtime_manager.runtime_health(runtime))

    assert connected is True
    assert "reachable recently" in detail

def test_runtime_health_treats_healthz_as_ready(monkeypatch):
    runtime = _runtime_for_health(status="starting", container_name="verxio-health-healthz")

    class FakeResponse:
        def __init__(self, payload=None, fail=False):
            self._payload = payload or {}
            self._fail = fail

        def raise_for_status(self):
            if self._fail:
                raise runtime_manager.httpx.HTTPStatusError(
                    "boom", request=None, response=None
                )

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url):
            if url.endswith("/api/healthz"):
                return FakeResponse({"ok": True})
            return FakeResponse(
                {"gateway_running": False, "gateway_state": "starting"},
            )

    monkeypatch.setattr(runtime_manager.httpx, "AsyncClient", FakeClient)

    connected, detail = asyncio.run(runtime_manager.runtime_health(runtime))

    assert connected is True
    assert "reachable" in detail

def test_runtime_health_status_fallback_waits_until_gateway_is_running(monkeypatch):
    runtime = _runtime_for_health(status="starting", container_name="verxio-health-gateway")

    class FakeResponse:
        def __init__(self, payload=None, fail=False):
            self._payload = payload or {}
            self._fail = fail

        def raise_for_status(self):
            if self._fail:
                raise RuntimeError("healthz missing")

        def json(self):
            return self._payload

    class FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, url):
            if url.endswith("/api/healthz"):
                return FakeResponse(fail=True)
            return FakeResponse(
                {"gateway_running": False, "gateway_state": "starting", "gateway_platforms": {}}
            )

    monkeypatch.setattr(runtime_manager.httpx, "AsyncClient", FakeClient)

    connected, detail = asyncio.run(runtime_manager.runtime_health(runtime))

    assert connected is False
    assert "gateway is starting" in detail

def test_slack_manifest_endpoint_returns_socket_mode_manifest(client):
    _, token = signup(client)
    response = client.get(
        "/api/messaging/slack/manifest?name=Verxio",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    payload = response.json()
    manifest = payload["manifest"]
    assert manifest["settings"]["socket_mode_enabled"] is True
    assert manifest["display_information"]["name"] == "Verxio"
    assert manifest["features"]["assistant_view"]["assistant_description"] == (
        "Chat with Verxio in threads and DMs."
    )
    slash_commands = manifest["features"]["slash_commands"]
    command_names = {entry["command"] for entry in slash_commands}
    assert "/verxio" in command_names
    assert "/hermes" not in command_names
    verxio_cmd = next(entry for entry in slash_commands if entry["command"] == "/verxio")
    assert "Verxio" in verxio_cmd["description"]
    assert "Hermes" not in verxio_cmd["description"]
    assert '"socket_mode_enabled": true' in payload["json"]
    assert '"command": "/verxio"' in payload["json"]

def test_secure_session_cookie_uses_samesite_none(client, monkeypatch):
    monkeypatch.setenv("VERXIO_COOKIE_SECURE", "true")

    payload, _token = signup(client, "desktop@example.com")
    logout = client.post("/api/auth/logout")
    assert logout.status_code == 200

    response = client.post(
        "/api/auth/login",
        json={"email": "desktop@example.com", "password": "password-123"},
    )

    assert response.status_code == 200
    set_cookie = response.headers.get("set-cookie", "")
    assert "samesite=none" in set_cookie.lower()
    assert "secure" in set_cookie.lower()
    assert response.cookies.get(SESSION_COOKIE)

