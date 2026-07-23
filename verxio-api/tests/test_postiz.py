from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

from app import control_plane, db, main, postiz
from app.auth import SESSION_COOKIE
from app.main import app


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.setenv("POSTIZ_INTERNAL_URL", "http://postiz.test")
    monkeypatch.setenv("POSTIZ_PUBLIC_URL", "http://127.0.0.1:4007")
    db.run_migrations()

    with TestClient(app) as test_client:
        yield test_client


def latest_auth_code(email: str, purpose: str) -> str:
    from app import emailer

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

    verify = client.post(
        "/api/auth/verify-email",
        json={"email": email, "code": latest_auth_code(email, "email_verify")},
    )
    assert verify.status_code == 200
    token = verify.cookies.get(SESSION_COOKIE)
    assert token
    return verify.json(), token


def test_postiz_status_requires_auth(client):
    response = client.get("/api/postiz/status")
    assert response.status_code == 401


def test_postiz_enable_uses_platform_api_key(client, monkeypatch):
    payload, token = signup(client, "postiz-platform@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "platform-key-123")

    response = client.post(
        "/api/postiz/enable",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["configured"] is True
    assert body["binding"]["status"] == "active"
    assert body["binding"]["workspaceId"] == payload["workspace"]["id"]
    assert body["toolBridge"]["enabled"] is True

    row = db.fetch_one(
        "SELECT status, credentials_encrypted FROM postiz_workspaces WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert row
    assert row["status"] == "active"
    credentials = postiz.decrypt_credentials(row["credentials_encrypted"])
    assert credentials["api_key"] == "platform-key-123"


def test_postiz_provision_registers_and_reads_public_api(client, monkeypatch):
    payload, token = signup(client, "postiz-provision@example.com")
    monkeypatch.delenv("POSTIZ_PLATFORM_API_KEY", raising=False)

    calls: list[tuple[str, str]] = []

    class FakeResponse:
        def __init__(self, status_code: int, payload=None, headers=None, cookies=None):
            self.status_code = status_code
            self._payload = payload
            self.headers = headers or {}
            self.cookies = cookies or {}
            self.text = ""

        def json(self):
            return self._payload

        def raise_for_status(self):
            if self.status_code >= 400:
                raise AssertionError(f"unexpected status {self.status_code}")

    class FakeClient:
        def __init__(self, *args, **kwargs):
            self.cookies = kwargs.get("cookies") or {}

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return False

        def post(self, path, json=None):
            calls.append(("POST", path))
            if path == "/api/auth/register":
                return FakeResponse(200, {"register": True})
            if path == "/api/auth/login":
                return FakeResponse(
                    200,
                    {"login": True},
                    headers={"auth": "jwt-token-123", "showorg": "org_abc"},
                )
            if path == "/api/user/api-key/rotate":
                return FakeResponse(200, {"apiKey": "unused"})
            raise AssertionError(f"unexpected POST {path}")

        def get(self, path):
            calls.append(("GET", path))
            if path == "/api/user/self":
                return FakeResponse(
                    200,
                    {"id": "user_1", "orgId": "org_abc", "publicApi": "postiz-key-from-self"},
                )
            raise AssertionError(f"unexpected GET {path}")

    monkeypatch.setattr(postiz.httpx, "Client", FakeClient)

    response = client.post(
        "/api/postiz/enable",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["binding"]["status"] == "active"
    assert body["binding"]["postizOrgId"] == "org_abc"
    assert body["binding"]["postizUserId"] == "user_1"
    assert ("POST", "/api/auth/register") in calls
    assert ("POST", "/api/auth/login") in calls
    assert ("GET", "/api/user/self") in calls

    env = postiz.runtime_env_for_workspace(payload["workspace"]["id"])
    assert env == {
        "POSTIZ_API_URL": "http://postiz.test",
        "POSTIZ_API_KEY": "postiz-key-from-self",
    }


def test_postiz_session_parses_set_cookie_domain_mismatch():
    class FakeHeaders:
        def get(self, key, default=None):
            if key.lower() == "set-cookie":
                return "auth=jwt-token; Domain=127.0.0.1; Path=/; HttpOnly; Secure; SameSite=None"
            return default

    class FakeResponse:
        cookies = {}
        headers = FakeHeaders()

    assert postiz._session_from_response(FakeResponse()) == {"auth": "jwt-token"}


def test_postiz_bridge_writes_runtime_mcp_server(client, monkeypatch):
    payload, token = signup(client, "postiz-bridge@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "bridge-key")

    response = client.post(
        "/api/postiz/enable",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )
    assert response.status_code == 200
    assert response.json()["toolBridge"]["enabled"] is True

    runtime_row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ?",
        (payload["workspace"]["id"],),
    )
    assert runtime_row
    runtime = control_plane.runtime_from_row(runtime_row)

    config = yaml.safe_load((Path(runtime.hermes_home_path) / "config.yaml").read_text(encoding="utf-8"))
    assert "postiz:" in yaml.safe_dump(config)
    assert config["mcp_servers"]["postiz"]["url"] == "http://postiz.test/mcp"
    assert config["mcp_servers"]["postiz"]["headers"]["Authorization"] == "Bearer ${POSTIZ_API_KEY}"
    assert "<!-- VERXIO_POSTIZ_CONTEXT_START -->" in config["agent"]["system_prompt"]


def test_postiz_public_proxy_forwards_authorization(client, monkeypatch):
    payload, token = signup(client, "postiz-proxy@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "proxy-key")

    client.post("/api/postiz/enable", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    captured: dict[str, str] = {}

    class FakeUpstream:
        status_code = 200
        content = b'{"integrations":[]}'
        headers = {"content-type": "application/json"}

    def fake_public_v1_request(workspace_id, method, path, **kwargs):
        captured["workspace_id"] = workspace_id
        captured["method"] = method
        captured["path"] = path
        return FakeUpstream()

    monkeypatch.setattr("app.main.postiz_public_v1_request", fake_public_v1_request)

    response = client.get(
        "/api/postiz/v1/integrations",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    assert captured == {
        "workspace_id": payload["workspace"]["id"],
        "method": "GET",
        "path": "integrations",
    }


def test_postiz_status_includes_channel_count(client, monkeypatch):
    payload, token = signup(client, "postiz-status-count@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "status-key")
    client.post("/api/postiz/enable", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    def fake_public_v1_json(workspace_id, method, path, **kwargs):
        assert workspace_id == payload["workspace"]["id"]
        assert method == "GET"
        assert path == "integrations"
        return {"integrations": [{"id": "int_1"}, {"id": "int_2"}]}

    monkeypatch.setattr(main, "postiz_public_v1_json", fake_public_v1_json)
    monkeypatch.setattr(main, "postiz_health", lambda: {"ok": True, "status": 200})

    response = client.get(
        "/api/postiz/status",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["channelCount"] == 2
    assert body["health"] == {"ok": True, "status": 200}


def test_postiz_named_routes_wrap_public_api(client, monkeypatch):
    payload, token = signup(client, "postiz-named-routes@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "named-routes-key")
    client.post("/api/postiz/enable", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    calls: list[tuple[str, str, dict]] = []

    def fake_public_v1_json(workspace_id, method, path, **kwargs):
        assert workspace_id == payload["workspace"]["id"]
        calls.append((method, path, kwargs))
        if path == "integrations":
            return {"integrations": [{"id": "int_1", "name": "X"}]}
        if path == "posts":
            return {"posts": [{"id": "post_1", "content": "hello"}]}
        if path == "social/x":
            return {"url": "http://postiz.test/connect/x"}
        if path == "integrations/int_1":
            return {"deleted": True}
        raise AssertionError(f"unexpected path {path}")

    monkeypatch.setattr(main, "postiz_public_v1_json", fake_public_v1_json)
    headers = {"Cookie": f"{SESSION_COOKIE}={token}"}

    integrations = client.get("/api/postiz/integrations", headers=headers)
    posts = client.get("/api/postiz/posts?from=2026-07-23", headers=headers)
    connect = client.post("/api/postiz/connect-url", headers=headers, json={"provider": "x"})
    delete = client.delete("/api/postiz/integrations/int_1", headers=headers)

    assert integrations.status_code == 200
    assert integrations.json()["integrations"] == [{"id": "int_1", "name": "X"}]
    assert posts.status_code == 200
    assert posts.json()["posts"] == [{"id": "post_1", "content": "hello"}]
    assert connect.status_code == 200
    assert connect.json()["url"] == "http://postiz.test/connect/x"
    assert delete.status_code == 200
    assert delete.json()["ok"] is True
    assert ("GET", "posts", {"params": {"from": "2026-07-23"}}) in calls


def test_postiz_disable_clears_binding(client, monkeypatch):
    payload, token = signup(client, "postiz-disable@example.com")
    monkeypatch.setenv("POSTIZ_PLATFORM_API_KEY", "disable-key")

    client.post("/api/postiz/enable", headers={"Cookie": f"{SESSION_COOKIE}={token}"})

    response = client.post(
        "/api/postiz/disable",
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["binding"]["status"] == "disabled"
    assert postiz.runtime_env_for_workspace(payload["workspace"]["id"]) == {}
