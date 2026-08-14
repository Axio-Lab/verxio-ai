from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient

from app import control_plane, db, emailer
from app.auth import SESSION_COOKIE
from app.main import app
from app.messaging_webhooks import public_hooks_base, rewrite_webhook_urls
from tests.test_api import signup


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


class _Req:
    def __init__(self, base: str) -> None:
        self.base_url = base


def test_rewrite_webhook_urls_uses_verxio_public_path():
    payload = {
        "enabled": True,
        "base_url": "http://0.0.0.0:8644",
        "subscriptions": [
            {
                "name": "github-pr",
                "url": "http://0.0.0.0:8644/webhooks/github-pr",
                "secret_set": True,
            }
        ],
    }
    out = rewrite_webhook_urls(payload, "https://app.verxio.xyz/api/hooks/ws_abc")
    assert out["base_url"] == "https://app.verxio.xyz/api/hooks/ws_abc"
    assert out["subscriptions"][0]["url"] == "https://app.verxio.xyz/api/hooks/ws_abc/github-pr"


def test_rewrite_webhook_urls_scopes_non_default_connection():
    from app.messaging_webhooks import public_hook_url, rewrite_webhook_urls

    payload = {
        "enabled": True,
        "base_url": "http://0.0.0.0:8644",
        "subscriptions": [
            {
                "name": "github-pr",
                "url": "http://0.0.0.0:8644/c/webh_ab12/webhooks/github-pr",
                "webhook_connection_id": "webh_ab12",
                "secret_set": True,
            }
        ],
    }
    out = rewrite_webhook_urls(payload, "https://app.verxio.xyz/api/hooks/ws_abc")
    assert out["subscriptions"][0]["url"] == "https://app.verxio.xyz/api/hooks/ws_abc/c/webh_ab12/github-pr"
    assert public_hook_url("https://app.verxio.xyz/api/hooks/ws_abc", "alerts") == (
        "https://app.verxio.xyz/api/hooks/ws_abc/alerts"
    )


def test_public_hooks_base_prefers_web_url(monkeypatch):
    monkeypatch.setenv("VERXIO_PUBLIC_WEB_URL", "https://app.verxio.xyz")
    monkeypatch.delenv("VERXIO_PUBLIC_API_URL", raising=False)
    assert public_hooks_base(_Req("http://127.0.0.1:8787/"), "ws_1") == (
        "https://app.verxio.xyz/api/hooks/ws_1"
    )


def test_list_messaging_webhooks_rewrites_urls(client, monkeypatch):
    payload, token = signup(client, "hooks-list@example.com")
    workspace_id = payload["workspace"]["id"]

    async def fake_list(request, user):
        from app.messaging_webhooks import public_hooks_base, rewrite_webhook_urls

        return rewrite_webhook_urls(
            {
                "enabled": True,
                "base_url": "http://0.0.0.0:8644",
                "subscriptions": [{"name": "alerts", "url": "http://0.0.0.0:8644/webhooks/alerts"}],
            },
            public_hooks_base(request, workspace_id),
        )

    monkeypatch.setattr("app.main.list_messaging_webhooks", fake_list)
    monkeypatch.setenv("VERXIO_PUBLIC_WEB_URL", "https://app.verxio.xyz")
    listed = client.get("/api/messaging/webhooks", headers={"Cookie": f"{SESSION_COOKIE}={token}"})
    assert listed.status_code == 200
    body = listed.json()
    assert body["base_url"] == f"https://app.verxio.xyz/api/hooks/{workspace_id}"
    assert body["subscriptions"][0]["url"] == f"https://app.verxio.xyz/api/hooks/{workspace_id}/alerts"


def test_create_messaging_webhook_requires_auth(client):
    response = client.post("/api/messaging/webhooks", json={"name": "alerts", "deliver": "telegram"})
    assert response.status_code in {401, 403}


def test_assert_deliver_target_requires_connection_and_home(monkeypatch):
    from fastapi import HTTPException

    from app.messaging_webhooks import assert_deliver_target
    from app.models import RuntimeInstance

    runtime = RuntimeInstance(
        id="rt-1",
        tenant_id="t1",
        workspace_id="ws-1",
        agent_id="a1",
        mode="local-docker",
        status="running",
        hermes_home_path="/tmp/h",
        workspace_path="/tmp/w",
        artifact_path="/tmp/a",
    )

    async def disconnected(_runtime):
        return [{"id": "telegram", "state": "not_configured", "configured": False, "enabled": False}]

    monkeypatch.setattr("app.messaging_webhooks._load_messaging_platforms", disconnected)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(assert_deliver_target(runtime, "telegram", None))
    assert exc.value.status_code == 400
    assert "No connection" in str(exc.value.detail)

    async def no_home(_runtime):
        return [{"id": "telegram", "state": "connected", "configured": True, "enabled": True, "home_channel": None}]

    monkeypatch.setattr("app.messaging_webhooks._load_messaging_platforms", no_home)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(assert_deliver_target(runtime, "telegram", None))
    assert "home channel" in str(exc.value.detail).lower()

    async def ready(_runtime):
        return [
            {
                "id": "telegram",
                "state": "connected",
                "configured": True,
                "enabled": True,
                "home_channel": {"chat_id": "123", "name": "Donatus", "platform": "telegram"},
            }
        ]

    monkeypatch.setattr("app.messaging_webhooks._load_messaging_platforms", ready)
    assert asyncio.run(assert_deliver_target(runtime, "telegram", None)) == ("123", None)


def test_assert_deliver_target_accepts_named_connection(monkeypatch):
    from app.messaging_webhooks import assert_deliver_target
    from app.models import RuntimeInstance

    runtime = RuntimeInstance(
        id="rt-1",
        tenant_id="t1",
        workspace_id="ws-1",
        agent_id="a1",
        mode="local-docker",
        status="running",
        hermes_home_path="/tmp/h",
        workspace_path="/tmp/w",
        artifact_path="/tmp/a",
    )

    async def ready(_runtime):
        return [
            {
                "id": "telegram",
                "state": "connected",
                "configured": True,
                "enabled": True,
                "home_channel": {"chat_id": "123", "name": "Donatus", "platform": "telegram"},
                "connections": [
                    {"id": "default", "configured": True, "enabled": True, "identity": "@Support"},
                    {"id": "conn_sales", "configured": True, "enabled": True, "identity": "@Sales"},
                ],
            }
        ]

    monkeypatch.setattr("app.messaging_webhooks._load_messaging_platforms", ready)
    assert asyncio.run(assert_deliver_target(runtime, "telegram::conn_sales", None)) == (
        "123",
        "conn_sales",
    )
    assert asyncio.run(assert_deliver_target(runtime, "telegram", None, "conn_sales")) == (
        "123",
        "conn_sales",
    )


def test_ingest_messaging_hook_forwards_to_runtime(client, monkeypatch):
    payload, _token = signup(client, "hooks-ingest@example.com")
    workspace_id = payload["workspace"]["id"]
    forwarded: list[tuple[str, bytes, str]] = []

    class _Upstream:
        status_code = 200
        content = b'{"status":"ok"}'
        headers = {"content-type": "application/json"}

    async def fake_ingest(workspace, route, request):
        body = await request.body()
        forwarded.append((workspace, route.encode(), body))
        return _Upstream()

    monkeypatch.setattr("app.main.ingest_public_hook", fake_ingest)
    response = client.post(
        f"/api/hooks/{workspace_id}/github-pr",
        json={"action": "opened"},
        headers={"X-Hub-Signature-256": "sha256=abc", "X-GitHub-Event": "pull_request"},
    )
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
    assert forwarded[0][0] == workspace_id
    assert forwarded[0][1] == b"github-pr"
