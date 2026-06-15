from __future__ import annotations

from pathlib import Path
from subprocess import CompletedProcess

import pytest
from fastapi.testclient import TestClient

from app import composio_catalog, control_plane, db, emailer, main
from app.auth import SESSION_COOKIE
from app.main import app


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
    assert payload["runtime"]["mode"] == "demo"


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


def test_protected_composio_endpoint_rejects_anonymous_users(client):
    response = client.get("/api/composio/connections/apps")

    assert response.status_code == 401


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

    user_one_response = client.get("/api/artifacts", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    user_two_response = client.get("/api/artifacts", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})

    assert user_one_response.status_code == 200
    assert user_two_response.status_code == 200
    user_one_artifacts = user_one_response.json()["artifacts"]
    assert [artifact["file_name"] for artifact in user_one_artifacts] == ["daily-sales-dashboard.html"]
    assert user_two_response.json()["artifacts"] == []

    artifact_id = user_one_artifacts[0]["id"]
    preview = client.get(f"/api/artifacts/{artifact_id}/preview", headers={"Cookie": f"{SESSION_COOKIE}={token_one}"})
    blocked = client.get(f"/api/artifacts/{artifact_id}/preview", headers={"Cookie": f"{SESSION_COOKIE}={token_two}"})

    assert preview.status_code == 200
    assert blocked.status_code == 404


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
    assert accounts.json() == {"accounts": [], "configured": False}
    assert len(apps.json()["apps"]) == 15
    assert apps.json()["apps"][0]["slug"] == "gmail"
    assert tools.json()["configured"] is False
    assert tools.json()["tools"][0]["slug"] == "GMAIL_SEARCH_EMAILS"
    assert initiate.status_code == 500
    assert initiate.json()["detail"] == "Composio is not configured."


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
        assert url.endswith("/connected_accounts/initiate")
        assert payload["config"]["val"]["generic_api_key"] == "secret-key"
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

    response = client.post(
        "/api/composio/connections/initiate",
        json={"appSlug": "twitter"},
        headers={"Cookie": f"{SESSION_COOKIE}={token}"},
    )

    assert response.status_code == 400
    assert "oauth app" in response.json()["detail"].lower()


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
