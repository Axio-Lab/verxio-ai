from __future__ import annotations

import hashlib
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from fastapi import HTTPException

from app import db, emailer, main
from app.agent_sync import normalize_path
from app.auth import SESSION_COOKIE
from app.main import app
from app.models import ComposioConnectedAccount
from tests.test_api import signup


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-desktop-cloud.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_WORKFLOW_SCHEDULER_ENABLED", "0")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.setenv("VERXIO_SIGNUP_INVITE_CODE", "97685")
    monkeypatch.setenv("VERXIO_HOSTED_QWEN_API_KEY", "test-qwen-secret")
    monkeypatch.setenv("VERXIO_HOSTED_GEMINI_API_KEY", "test-gemini-secret")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    emailer.SENT_AUTH_EMAILS.clear()
    from app.runtime_orch.leases import reset_lease_store_for_tests

    reset_lease_store_for_tests()
    db.run_migrations()

    with TestClient(app) as test_client:
        yield test_client


def _auth(client: TestClient, email: str = "desktop@example.com") -> dict[str, str]:
    _payload, token = signup(client, email)
    return {"Cookie": f"{SESSION_COOKIE}={token}"}


def test_device_token_issue_list_revoke_and_bearer_auth(client):
    headers = _auth(client)
    created = client.post("/api/auth/device", json={"name": "MacBook", "platform": "darwin"}, headers=headers)
    assert created.status_code == 200
    token = created.json()["token"]
    assert token.startswith("vxd_")
    token_id = created.json()["device"]["id"]

    listed = client.get("/api/auth/device", headers=headers)
    assert listed.status_code == 200
    assert listed.json()["devices"][0]["id"] == token_id

    models = client.get("/api/inference/v1/models", headers={"Authorization": f"Bearer {token}"})
    assert models.status_code == 200
    ids = {row["id"] for row in models.json()["data"]}
    assert "verxio-qwen" in ids
    assert "verxio-gemini" in ids

    revoked = client.delete(f"/api/auth/device/{token_id}", headers=headers)
    assert revoked.status_code == 200
    client.cookies.clear()
    denied = client.get("/api/inference/v1/models", headers={"Authorization": f"Bearer {token}"})
    assert denied.status_code == 401


def test_inference_gateway_meters_usage(client):
    headers = _auth(client, "meter@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    token = created.json()["token"]

    upstream = {
        "id": "chatcmpl-test",
        "choices": [{"index": 0, "message": {"role": "assistant", "content": "hello"}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 20},
    }

    class _FakeResponse:
        status_code = 200

        def json(self):
            return upstream

    fake_client = AsyncMock()
    fake_client.post = AsyncMock(return_value=_FakeResponse())
    fake_client.__aenter__ = AsyncMock(return_value=fake_client)
    fake_client.__aexit__ = AsyncMock(return_value=None)

    with patch("app.inference_gateway.httpx.AsyncClient", return_value=fake_client):
        response = client.post(
            "/api/inference/v1/chat/completions",
            headers={"Authorization": f"Bearer {token}"},
            json={"model": "verxio-qwen", "messages": [{"role": "user", "content": "hi"}]},
        )

    assert response.status_code == 200
    assert response.json()["choices"][0]["message"]["content"] == "hello"
    usage = client.get("/api/inference/usage", headers=headers)
    assert usage.status_code == 200
    assert usage.json()["usage"]["events"] == 1
    assert usage.json()["usage"]["usedUsd"] > 0


def test_inference_gateway_rejects_when_credit_exhausted(client, monkeypatch):
    headers = _auth(client, "broke@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    token = created.json()["token"]
    me = client.get("/api/auth/me", headers=headers).json()
    user_id = me["user"]["id"]
    client.get("/api/inference/usage", headers=headers)
    db.execute(
        """
        UPDATE user_inference_settings
        SET monthly_credit_usd = 1, overage_enabled = 0, spending_limit_usd = 1
        WHERE user_id = ?
        """,
        (user_id,),
    )
    db.execute(
        """
        INSERT INTO usage_events (
            id, user_id, workspace_id, agent_id, runtime_id, session_id, turn_id,
            mode, verxio_model_id, provider_slug, upstream_model_id,
            input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,
            reasoning_tokens, estimated_provider_cost_usd, billed_cost_usd,
            cost_source, metadata_json, created_at
        ) VALUES ('use_over', ?, NULL, NULL, NULL, NULL, 'turn_over', 'hosted',
                  'verxio-qwen', 'alibaba', 'qwen3.6-plus', 0, 0, 0, 0, 0, 2, 2, 'catalog', '{}', '2026-01-01T00:00:00+00:00')
        """,
        (user_id,),
    )
    response = client.post(
        "/api/inference/v1/chat/completions",
        headers={"Authorization": f"Bearer {token}"},
        json={"model": "verxio-qwen", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 402


def test_agent_state_allowlist_etag_and_outputs_readonly(client):
    headers = _auth(client, "sync@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    token = created.json()["token"]
    bearer = {"Authorization": f"Bearer {token}"}

    denied = client.put("/api/agent/state/not-allowed.txt", headers=bearer, content=b"nope")
    assert denied.status_code == 403
    with pytest.raises(HTTPException) as traversal:
        normalize_path("../etc/passwd")
    assert traversal.value.status_code == 400

    soul = client.put("/api/agent/state/SOUL.md", headers=bearer, content=b"# Verxio\n")
    assert soul.status_code == 200
    etag = soul.json()["etag"]
    assert etag == hashlib.sha256(b"# Verxio\n").hexdigest()

    conflict = client.put(
        "/api/agent/state/SOUL.md",
        headers={**bearer, "If-Match": "stale"},
        content=b"# Next\n",
    )
    assert conflict.status_code == 412

    ok = client.put(
        "/api/agent/state/SOUL.md",
        headers={**bearer, "If-Match": etag},
        content=b"# Next\n",
    )
    assert ok.status_code == 200

    fetched = client.get("/api/agent/state/SOUL.md", headers=bearer)
    assert fetched.status_code == 200
    assert fetched.content == b"# Next\n"

    blocked = client.put("/api/agent/state/outputs/report.md", headers=bearer, content=b"secret")
    assert blocked.status_code == 403

    cloud = client.put(
        "/api/agent/state/outputs/report.md",
        headers={**bearer, "X-Verxio-State-Actor": "cloud"},
        content=b"from cloud",
    )
    assert cloud.status_code == 200
    assert cloud.json()["expiresAt"]

    listing = client.get("/api/agent/state", headers=bearer)
    paths = {row["path"] for row in listing.json()["entries"]}
    assert "SOUL.md" in paths
    assert "outputs/report.md" in paths


def test_agent_state_config_merges_agent_section_only(client):
    headers = _auth(client, "config@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    bearer = {"Authorization": f"Bearer {created.json()['token']}"}
    first = client.put(
        "/api/agent/state/config.yaml",
        headers=bearer,
        content=b"agent:\n  name: Verxio\nterminal:\n  backend: local\n",
    )
    assert first.status_code == 200
    second = client.put(
        "/api/agent/state/config.yaml",
        headers=bearer,
        content=b"agent:\n  name: Desktop\n",
    )
    assert second.status_code == 200
    body = client.get("/api/agent/state/config.yaml", headers=bearer)
    assert b"name: Desktop" in body.content
    assert b"terminal" not in body.content


def test_expire_all_outputs_and_bounded_home_copy(tmp_path, monkeypatch):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "state.sqlite3"))
    from app import db
    from app.agent_sync import expire_all_outputs
    from app.homes import copy_home_filtered

    db.run_migrations()

    source = tmp_path / "home"
    (source / "memory").mkdir(parents=True)
    (source / "memory" / "notes.md").write_text("ok")
    (source / "workspace").mkdir()
    (source / "workspace" / "secret.txt").write_text("nope")
    dest = tmp_path / "sync"
    copy_home_filtered(source, dest)
    assert (dest / "memory" / "notes.md").exists()
    assert not (dest / "workspace").exists()
    assert expire_all_outputs() == 0


def test_prune_old_cloud_sessions(tmp_path):
    import os
    import time

    from app.worker.tenants import prune_old_sessions

    sessions = tmp_path / "sessions"
    sessions.mkdir()
    fresh = sessions / "fresh.json"
    stale = sessions / "stale.json"
    fresh.write_text("{}")
    stale.write_text("{}")
    old = time.time() - 20 * 86400
    os.utime(stale, (old, old))
    assert prune_old_sessions(tmp_path, max_age_days=14) == 1
    assert fresh.exists()
    assert not stale.exists()


def test_default_cloud_plane_is_pool(monkeypatch):
    monkeypatch.delenv("VERXIO_RUNTIME_MANAGER", raising=False)
    from app.plane import default_plane

    assert default_plane() == "pool"


def test_composio_mcp_session_without_config(client):
    headers = _auth(client, "composio@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    response = client.post(
        "/api/composio/mcp-session",
        headers={"Authorization": f"Bearer {created.json()['token']}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is False
    assert payload["enabled"] is False


def test_composio_mcp_session_returns_url(client, monkeypatch):
    headers = _auth(client, "composio-on@example.com")
    created = client.post("/api/auth/device", json={"name": "Desktop"}, headers=headers)
    monkeypatch.setattr(main, "is_composio_configured", lambda: True)
    from app import composio_catalog

    monkeypatch.setattr(composio_catalog, "is_composio_configured", lambda: True)
    monkeypatch.setattr(
        composio_catalog,
        "list_composio_accounts",
        lambda _user_id: [
            ComposioConnectedAccount(id="acc_1", appSlug="gmail", status="ACTIVE"),
        ],
    )
    monkeypatch.setattr(
        composio_catalog,
        "_create_tool_router_session",
        lambda _user_id, _accounts: {"mcp": {"url": "https://mcp.composio.dev/session/test"}},
    )
    response = client.post(
        "/api/composio/mcp-session",
        headers={"Authorization": f"Bearer {created.json()['token']}"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["enabled"] is True
    assert payload["mcpUrl"] == "https://mcp.composio.dev/session/test"
    assert "gmail" in payload["connectedApps"]
