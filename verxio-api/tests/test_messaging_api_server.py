from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import control_plane, db, emailer
from app.auth import SESSION_COOKIE
from app.main import app
from app.messaging_api_server import public_openai_base
from tests.test_api import signup
from tests.test_messaging_webhooks import _Req


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_WORKFLOW_SCHEDULER_ENABLED", "0")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    monkeypatch.delenv("VERXIO_SMTP_FROM", raising=False)
    monkeypatch.setattr(control_plane, "RUNTIME_ROOT", tmp_path / "runtimes")
    emailer.SENT_AUTH_EMAILS.clear()
    db.run_migrations()

    with TestClient(app) as test_client:
        yield test_client


def test_public_openai_base_prefers_web_url(monkeypatch):
    monkeypatch.setenv("VERXIO_PUBLIC_WEB_URL", "https://app.verxio.xyz")
    monkeypatch.delenv("VERXIO_PUBLIC_API_URL", raising=False)
    assert public_openai_base(_Req("http://127.0.0.1:8787/"), "ws_1") == (
        "https://app.verxio.xyz/api/openai/ws_1/v1"
    )


def test_get_messaging_api_server_requires_auth(client):
    response = client.get("/api/messaging/api-server")
    assert response.status_code in {401, 403}


def test_get_messaging_api_server_returns_public_url(client, monkeypatch):
    payload, token = signup(client, "api-server@example.com")
    workspace_id = payload["workspace"]["id"]

    async def fake_platforms(_runtime):
        return [
            {
                "id": "api_server",
                "enabled": True,
                "env_vars": [{"key": "API_SERVER_MODEL_NAME", "current_value": "verxio"}],
            }
        ]

    monkeypatch.setattr("app.messaging_api_server._load_messaging_platforms", fake_platforms)
    monkeypatch.setenv("VERXIO_PUBLIC_WEB_URL", "https://app.verxio.xyz")
    listed = client.get("/api/messaging/api-server", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert listed.status_code == 200
    body = listed.json()
    assert body["enabled"] is True
    assert body["base_url"] == f"https://app.verxio.xyz/api/openai/{workspace_id}/v1"
    assert body["model"] == "verxio"
    assert "/chat/completions" in body["example"]
