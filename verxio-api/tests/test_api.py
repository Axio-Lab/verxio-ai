from __future__ import annotations

import asyncio
import base64
import json
import os
from pathlib import Path
from subprocess import CompletedProcess

import pytest
import yaml
from fastapi.testclient import TestClient

from app import composio_catalog, control_plane, db, emailer, inference, main, runtime_manager, transcription_catalog
from app.auth import SESSION_COOKIE
from app.main import app
from app.models import ComposioConnectedAccount, ComposioToolBridgeStatus, RuntimeInstance


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    monkeypatch.delenv("VERXIO_SMTP_FROM", raising=False)
    monkeypatch.setattr(control_plane, "RUNTIME_ROOT", tmp_path / "runtimes")
    emailer.SENT_AUTH_EMAILS.clear()
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


def test_create_run_uses_demo_runtime(client):
    response = client.post(
        "/api/runs",
        json={
            "agent_id": "verxio-agent",
            "input": "Help me use Verxio instead of Hermes CLI.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["agent_id"] == "verxio-agent"
    assert payload["provider"] == "demo"
    assert payload["status"] == "completed"
    assert "Verxio Agent" in payload["output"]


def test_unknown_agent_returns_404(client):
    response = client.post(
        "/api/runs",
        json={
            "agent_id": "unknown",
            "input": "Do something useful.",
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


def test_dashboard_env_mutations_reassert_hosted_inference_env():
    assert main._dashboard_path_needs_inference_env_reassert("api/env/reload", "POST")
    assert main._dashboard_path_needs_inference_env_reassert("api/env", "PUT")
    assert main._dashboard_path_needs_inference_env_reassert("api/tools/toolsets/tts/env", "PUT")
    assert not main._dashboard_path_needs_inference_env_reassert("api/model/options", "GET")
    assert not main._dashboard_path_needs_inference_env_reassert("api/status", "GET")


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
    assert main._dashboard_path_needs_inference_sync("/api/model/options") is True
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
    assert auth.get("active_provider") == "openai-api"
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
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {"GEMINI_API_KEY": "verxio-gemini-key"}
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
    assert auth.get("active_provider") == "alibaba"


def test_inference_bridge_byok_strips_hosted_model_assignment(client, monkeypatch):
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "verxio-qwen-key")
    payload, token = signup(client, "inference-byok@example.com")

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    # Seed hosted leftovers the way a prior Hosted session would leave them.
    hosted = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])
    assert hosted.enabled is True
    hermes_home = Path(runtime.hermes_home_path)
    (hermes_home / ".env").write_text(
        "OPENAI_API_KEY=user-byok-openai\nDASHSCOPE_API_KEY=keep-user-or-stale\n",
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
                            "id": "hosted",
                            "label": "DASHSCOPE_API_KEY",
                            "auth_type": "api_key",
                            "source": "env:DASHSCOPE_API_KEY",
                        }
                    ],
                    "openai-api": [
                        {
                            "id": "user",
                            "label": "OPENAI_API_KEY",
                            "auth_type": "api_key",
                            "source": "env:OPENAI_API_KEY",
                        }
                    ],
                },
            }
        ),
        encoding="utf-8",
    )

    # Flip mode in DB without the route sync so we can assert the bridge clear.
    db.execute(
        "UPDATE user_inference_settings SET mode = ? WHERE user_id = ?",
        ("byok", payload["user"]["id"]),
    )

    status = inference.sync_inference_runtime_bridge(runtime, payload["user"]["id"])

    assert status.enabled is False
    assert status.changed is True
    assert status.message == "BYOK mode uses Hermes provider settings."
    assert inference.runtime_env_for_user(payload["user"]["id"]) == {}

    config = (hermes_home / "config.yaml").read_text(encoding="utf-8")
    assert "provider: alibaba" not in config
    assert "default: qwen3.6-plus" not in config
    assert not (hermes_home / ".verxio" / "inference-runtime-bridge.json").exists()

    # User-owned Tools & Keys credentials stay on disk; hosted auth pool is cleared.
    env_text = (hermes_home / ".env").read_text(encoding="utf-8")
    assert "OPENAI_API_KEY=user-byok-openai" in env_text
    auth = json.loads((hermes_home / "auth.json").read_text(encoding="utf-8"))
    assert "alibaba" not in auth.get("credential_pool", {})
    assert "openai-api" in auth.get("credential_pool", {})

    # Settings PUT still accepts byok once leftovers are gone.
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


def test_password_login_for_unverified_user_resends_verification_code(client):
    response = client.post(
        "/api/auth/signup",
        json={
            "email": "unverified@example.com",
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


def test_artifacts_are_indexed_from_runtime_workspace_and_isolated(client):
    user_one, token_one = signup(client, "one@example.com")
    user_two, token_two = signup(client, "two@example.com")

    runtime_one = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (user_one["workspace"]["id"], user_one["profile"]["id"]),
    )
    assert runtime_one
    artifact_path = Path(str(runtime_one["artifact_path"]))
    artifact_path.mkdir(parents=True, exist_ok=True)
    (artifact_path / "daily-sales-dashboard.html").write_text("<html><body>Daily sales</body></html>", encoding="utf-8")
    png_bytes = base64.b64decode(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
    )
    (artifact_path / "man_in_pool_nano_banana.png").write_bytes(png_bytes)

    user_one_response = client.get("/api/artifacts", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    user_two_response = client.get("/api/artifacts", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})

    assert user_one_response.status_code == 200
    assert user_two_response.status_code == 200
    user_one_artifacts = user_one_response.json()["artifacts"]
    assert {artifact["file_name"] for artifact in user_one_artifacts} == {
        "daily-sales-dashboard.html",
        "man_in_pool_nano_banana.png",
    }
    image_artifact = next(artifact for artifact in user_one_artifacts if artifact["file_name"].endswith(".png"))
    assert image_artifact["content_type"] == "image/png"
    assert user_two_response.json()["artifacts"] == []

    artifact_id = image_artifact["id"]
    preview = client.get(f"/api/artifacts/{artifact_id}/preview", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    download = client.get(f"/api/artifacts/{artifact_id}/download", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    blocked = client.get(f"/api/artifacts/{artifact_id}/preview", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})

    assert preview.status_code == 200
    assert preview.headers["content-type"] == "image/png"
    assert "inline" in preview.headers.get("content-disposition", "").lower()
    assert preview.content == png_bytes
    assert download.status_code == 200
    assert "attachment" in download.headers.get("content-disposition", "").lower()
    assert blocked.status_code == 404

    blocked_delete = client.delete(f"/api/artifacts/{artifact_id}", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})
    deleted = client.delete(f"/api/artifacts/{artifact_id}", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})

    assert blocked_delete.status_code == 404
    assert deleted.status_code == 200
    assert deleted.json() == {"ok": True}
    assert not (artifact_path / "man_in_pool_nano_banana.png").exists()

    after_delete = client.get("/api/artifacts", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    assert after_delete.status_code == 200
    assert [artifact["file_name"] for artifact in after_delete.json()["artifacts"]] == ["daily-sales-dashboard.html"]


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

    artifacts = client.get("/api/artifacts", headers=headers)
    assert artifacts.status_code == 200
    assert artifact["relative_path"] in {item["relative_path"] for item in artifacts.json()["artifacts"]}


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


def test_notepad_summarize_uses_runtime_dashboard(client, monkeypatch):
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "auto")

    async def fake_run_agent_via_dashboard(workspace, profile, user_input, *, instructions=None):
        assert "Acme discovery call" in user_input
        return "Summary\n\nDecisions\n- Follow up on SOC2."

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
    assert "Google Docs / long content rules" in config
    assert "stringified JSON blob" in config
    assert "GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN" in config


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

    async def fake_restart(runtime, extra_env=None):
        restarted.append(runtime.id)
        return runtime

    monkeypatch.setattr(main, "restart_runtime", fake_restart)

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

    async def fake_restart(runtime, extra_env=None):
        restarted.append(runtime.id)
        return runtime

    monkeypatch.setattr(main, "restart_runtime", fake_restart)

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

    async def fake_restart(runtime, extra_env=None):
        restarted.append(runtime.id)
        return runtime

    async def fake_soft_reload(runtime):
        soft_reloads.append(runtime.id)
        return {"ok": True, "message": "Reloaded MCP servers (3 tool(s)).", "toolCount": 3}

    monkeypatch.setattr(main, "restart_runtime", fake_restart)
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


def test_runtime_start_updates_registry_without_real_docker(client, monkeypatch):
    monkeypatch.setenv("VERXIO_RUNTIME_DOCKER_ROOT", "/host/verxio/runtimes")
    monkeypatch.setenv("VERXIO_RUNTIME_CONNECT_HOST", "127.0.0.1")
    payload, token = signup(client, "runtime@example.com")
    calls: list[list[str]] = []

    def fake_docker(args: list[str]) -> CompletedProcess[str]:
        calls.append(args)
        if args[:2] == ["inspect", "-f"]:
            return CompletedProcess(args, 1, "", "not found")
        if args[:1] == ["run"]:
            return CompletedProcess(args, 0, "container_123\n", "")
        return CompletedProcess(args, 0, "", "")

    async def fake_health(_runtime):
        return True, "Hermes dashboard is reachable."

    monkeypatch.setattr(main, "runtime_health", fake_health)
    monkeypatch.setattr("app.runtime_manager._run_docker", fake_docker)

    response = client.post("/api/runtime/start", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    assert response.status_code == 200
    body = response.json()
    assert body["connected"] is True
    assert body["runtime"]["status"] == "starting"
    assert body["runtime"]["container_id"] == "container_123"
    assert body["runtime"]["dashboard_url"].startswith("http://127.0.0.1:")

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    assert runtime_row["container_id"] == "container_123"
    assert runtime_row["dashboard_token"]
    run_call = next(call for call in calls if call[:1] == ["run"])
    assert "/host/verxio/runtimes" in " ".join(run_call)
    assert "/workspace" in " ".join(run_call)
    assert "HERMES_WRITE_SAFE_ROOT=" in run_call
    assert "HERMES_MEDIA_ALLOW_DIRS=/workspace" in run_call


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


def test_runtime_health_waits_until_gateway_is_running(monkeypatch):
    runtime = _runtime_for_health(status="starting", container_name="verxio-health-gateway")

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"gateway_running": False, "gateway_state": "starting", "gateway_platforms": {}}

    class FakeClient:
        def __init__(self, *args, **kwargs):
            return None

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            return None

        async def get(self, _url):
            return FakeResponse()

    monkeypatch.setattr(runtime_manager.httpx, "AsyncClient", FakeClient)

    connected, detail = asyncio.run(runtime_manager.runtime_health(runtime))

    assert connected is False
    assert "gateway is starting" in detail


def test_leash_agent_config_is_runtime_local_not_db(client):
    payload, token = signup(client, "leash@example.com")
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}
    config = {"version": 1, "agent_mint": "Agnt123", "executive_keypair": "secret"}

    missing = client.get("/api/leash/agent-config", headers=headers)
    assert missing.status_code == 404

    saved = client.put("/api/leash/agent-config", headers=headers, json=config)
    assert saved.status_code == 200
    assert saved.json() == {"ok": True}

    loaded = client.get("/api/leash/agent-config", headers=headers)
    assert loaded.status_code == 200
    assert loaded.json()["config"] == config

    rows = db.fetch_all("SELECT * FROM runtime_instances WHERE workspace_id = ?", (payload["workspace"]["id"],))
    assert rows
    agent_path = Path(rows[0]["hermes_home_path"]) / ".config" / "leash" / "agent.json"
    assert agent_path.is_file()

    deleted = client.delete("/api/leash/agent-config", headers=headers)
    assert deleted.status_code == 200
    assert not agent_path.is_file()


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
