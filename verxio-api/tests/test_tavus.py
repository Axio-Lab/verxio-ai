from __future__ import annotations

import hashlib
import hmac
import json

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from app import db, emailer
from app.auth import SESSION_COOKIE
from app.main import app
from app.tavus_limits import cleanup_user
from tests.test_api import signup


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "tavus.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.setenv("VERXIO_SIGNUP_INVITE_CODE", "97685")
    monkeypatch.setenv("TAVUS_API_KEY", "tavus-test-key")
    monkeypatch.setenv("TAVUS_TOOL_SECRET", "tavus-tool-secret")
    monkeypatch.setenv("VERXIO_PUBLIC_API_URL", "https://api.example.test")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    emailer.SENT_AUTH_EMAILS.clear()
    from app.runtime_orch.leases import reset_lease_store_for_tests

    reset_lease_store_for_tests()
    db.run_migrations()
    with TestClient(app) as test_client:
        yield test_client


def _headers(client: TestClient) -> tuple[dict[str, str], str]:
    payload, token = signup(client, "tavus@example.com")
    return {"Cookie": f"{SESSION_COOKIE}={token}"}, str(payload["user"]["id"])


def _grant_key(client: TestClient, headers: dict[str, str], api_key: str = "user-tavus-key") -> None:
    saved = client.put("/api/tavus/credential", headers=headers, json={"apiKey": api_key})
    assert saved.status_code == 200, saved.text
    assert api_key not in saved.text


_PROFILE = {"displayName": "Ada", "faceId": "face_1", "voiceId": "voice_1"}


def _fake_tavus(calls: list[tuple[str, str]]):
    def request(method: str, path: str, *, json_body=None, timeout: float = 30):
        calls.append((method, path))
        blob = json.dumps(json_body or {})
        assert "tavus-test-key" not in blob
        assert "tavus-tool-secret" not in blob or path == "/v2/tools"
        if path == "/v2/tools":
            return {"tool_id": "tool_1"}
        if path.startswith("/v2/guardrails") and method == "GET":
            return {
                "data": [
                    {"uuid": "g_no_secrets", "guardrail_name": "no_secrets"},
                    {"uuid": "g_identity", "guardrail_name": "identity"},
                    {"uuid": "g_rules", "guardrail_name": "rules"},
                ]
            }
        if path == "/v2/guardrails":
            return {"uuid": "guard_1"}
        if path.startswith("/v2/faces") and method == "GET":
            return {"data": [{"face_id": "face_1", "face_name": "Anna", "face_type": "system"}]}
        if path.startswith("/v2/voices") and method == "GET":
            return {"data": [{"voice_id": "voice_1", "voice_name": "Anna", "voice_type": "system", "status": "completed"}]}
        if path == "/v2/pals" and method == "POST":
            assert "verxio_start_task" in blob
            assert "hermes_tools" not in blob
            assert json_body["guardrail_ids"] == ["g_no_secrets", "g_identity", "g_rules"]
            return {"pal_id": "pal_user"}
        if path == "/v2/memory-stores" and method == "POST":
            return {"memory_store_id": "store_1"}
        if path.endswith("/pinned") and method == "POST":
            return {"pinned_memory_id": "pin_1"}
        if method == "DELETE":
            return {}
        return {}

    return request


def test_profile_creates_then_patches_the_same_pal(client, monkeypatch):
    headers, _user_id = _headers(client)
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tavus_profile.request", _fake_tavus(calls))
    monkeypatch.setattr("app.tavus_knowledge.tavus_request", _fake_tavus(calls))
    _grant_key(client, headers)
    first = client.put(
        "/api/tavus/profile",
        headers=headers,
        json={**_PROFILE, "tone": "Brief and warm.", "neverDo": "Invent numbers."},
    )
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["palId"] == "pal_user"
    assert "tavus-test-key" not in first.text
    assert "tavus-tool-secret" not in first.text
    assert body["spokenPrompt"].count("verxio_start_task") == 1
    second = client.put("/api/tavus/profile", headers=headers, json={"tone": "Even shorter."})
    assert second.status_code == 200, second.text
    assert second.json()["palId"] == "pal_user"
    assert sum(1 for method, path in calls if method == "POST" and path == "/v2/pals") == 1
    assert any(method == "PATCH" and path == "/v2/pals/pal_user" for method, path in calls)


def test_profile_reuses_a_tool_that_already_exists(client, monkeypatch):
    headers, _user_id = _headers(client)
    calls: list[tuple[str, str]] = []

    def request(method: str, path: str, *, json_body=None, timeout: float = 30):
        calls.append((method, path))
        if path == "/v2/tools" and method == "POST":
            raise HTTPException(status_code=502, detail="Bad Request. A tool with this name already exists")
        if path == "/v2/tools" and method == "GET":
            return {"data": [{"tool_id": "tool_existing", "name": "verxio_start_task"}]}
        if path.startswith("/v2/guardrails") and method == "GET":
            return {
                "data": [
                    {"uuid": "g_no_secrets", "guardrail_name": "no_secrets"},
                    {"uuid": "g_identity", "guardrail_name": "identity"},
                    {"uuid": "g_rules", "guardrail_name": "rules"},
                ]
            }
        if path.startswith("/v2/faces") and method == "GET":
            return {"data": [{"face_id": "face_1", "face_name": "Anna", "face_type": "system"}]}
        if path.startswith("/v2/voices") and method == "GET":
            return {"data": [{"voice_id": "voice_1", "voice_name": "Anna", "voice_type": "system"}]}
        if path == "/v2/pals" and method == "POST":
            assert json_body["tool_ids"] == ["tool_existing"]
            assert json_body["guardrail_ids"] == ["g_no_secrets", "g_identity", "g_rules"]
            return {"pal_id": "pal_user"}
        if path == "/v2/memory-stores" and method == "POST":
            return {"memory_store_id": "store_1"}
        if path.endswith("/pinned") and method == "POST":
            return {"pinned_memory_id": "pin_1"}
        return {}

    monkeypatch.setattr("app.tavus_profile.request", request)
    monkeypatch.setattr("app.tavus_knowledge.tavus_request", request)
    _grant_key(client, headers)
    saved = client.put("/api/tavus/profile", headers=headers, json=_PROFILE)
    assert saved.status_code == 200, saved.text
    assert saved.json()["taskToolReady"] is True
    assert ("GET", "/v2/tools") in calls


def test_task_signature_and_duplicate_tool_call(client):
    headers, user_id = _headers(client)
    db.execute(
        """
        INSERT INTO tavus_conversations (
            conversation_id, user_id, kind, status, callback_token_hash, started_at, created_at
        ) VALUES ('c_1', ?, 'app', 'active', 'hash', '2026-10-05T09:00:00+00:00', '2026-10-05T09:00:00+00:00')
        """,
        (user_id,),
    )
    payload = {
        "arguments": json.dumps({"instruction": "Add a row to Airtable"}),
        "conversation_id": "c_1",
        "tool_call_id": "call_1",
    }
    raw = json.dumps(payload, sort_keys=True).encode("utf-8")
    good = hmac.new(b"tavus-tool-secret", raw, hashlib.sha256).hexdigest()
    denied = client.post("/api/tavus/tools/start-task", content=raw, headers={"X-Tavus-Signature": "nope"})
    assert denied.status_code == 401
    accepted = client.post(
        "/api/tavus/tools/start-task",
        content=raw,
        headers={"Content-Type": "application/json", "X-Tavus-Signature": good},
    )
    assert accepted.status_code == 200, accepted.text
    again = client.post(
        "/api/tavus/tools/start-task",
        content=raw,
        headers={"Content-Type": "application/json", "X-Tavus-Signature": good},
    )
    assert again.status_code == 200
    assert again.json()["taskId"] == accepted.json()["taskId"]
    rows = db.fetch_all("SELECT id FROM tavus_tasks WHERE tool_call_id = 'call_1'")
    assert len(rows) == 1
    claimed = client.get("/api/tavus/tasks/next?wait=0", headers=headers)
    assert claimed.status_code == 200
    assert claimed.json()["task"]["instruction"] == "Add a row to Airtable"


def test_webhook_rejects_unknown_token(client):
    response = client.post("/api/tavus/webhooks/not-a-real-token", json={"event_type": "system.shutdown"})
    assert response.status_code == 404


def test_call_stops_when_the_minute_budget_is_spent(client, monkeypatch):
    headers, user_id = _headers(client)
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tavus_profile.request", _fake_tavus(calls))
    monkeypatch.setattr("app.tavus_knowledge.tavus_request", _fake_tavus(calls))
    _grant_key(client, headers)
    saved = client.put(
        "/api/tavus/profile",
        headers=headers,
        json={**_PROFILE, "monthlyMinuteBudget": 1},
    )
    assert saved.status_code == 200, saved.text
    db.execute(
        "UPDATE tavus_profiles SET minutes_used = 1, minutes_period = ? WHERE user_id = ?",
        (__import__("app.tavus_limits", fromlist=["period_key"]).period_key(), user_id),
    )
    monkeypatch.setattr("app.tavus_calls.tavus_request", _fake_tavus(calls))
    blocked = client.post("/api/tavus/conversations", headers=headers, json={})
    assert blocked.status_code == 429


def test_cleanup_deletes_every_tavus_resource(client, monkeypatch):
    headers, user_id = _headers(client)
    deleted: list[str] = []

    def request(method: str, path: str, *, json_body=None, timeout: float = 30):
        if method == "DELETE":
            deleted.append(path)
        return {}

    monkeypatch.setattr("app.tavus_limits.tavus_request", request)
    now = "2026-10-05T10:00:00+00:00"
    db.execute(
        """
        INSERT INTO tavus_profiles (
            user_id, pal_id, share_pal_id, face_id, voice_id, display_name, deployment_id,
            pronunciation_dictionary_id, created_at, updated_at
        ) VALUES (?, 'pal_1', 'pal_share', 'face_1', 'voice_1', 'Ada', 'dep_1', 'dict_1', ?, ?)
        """,
        (user_id, now, now),
    )
    for kind, tavus_id in (("face", "face_1"), ("voice", "voice_1"), ("document", "doc_1"), ("memory", "store_1")):
        db.execute(
            """
            INSERT INTO tavus_assets (id, user_id, kind, tavus_id, status, name, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)
            """,
            (f"asset-{kind}", user_id, kind, tavus_id, kind, now, now),
        )
    cleanup_user(user_id)
    assert "/v2/pals/pal_1" in deleted
    assert "/v2/pals/pal_share" in deleted
    assert "/v2/deployments/dep_1" in deleted
    assert "/v2/faces/face_1" in deleted
    assert "/v2/voices/voice_1" in deleted
    assert "/v2/documents/doc_1" in deleted
    assert "/v2/memory-stores/store_1" in deleted
    assert "/v2/pronunciation-dictionaries/dict_1" in deleted
    assert db.fetch_one("SELECT user_id FROM tavus_profiles WHERE user_id = ?", (user_id,)) is None


def test_profile_save_requires_a_user_key_and_a_chosen_face(client, monkeypatch):
    headers, _user_id = _headers(client)
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tavus_profile.request", _fake_tavus(calls))
    missing = client.put("/api/tavus/profile", headers=headers, json=_PROFILE)
    assert missing.status_code == 400
    assert "Tools & Keys" in missing.text
    assert calls == []
    _grant_key(client, headers)
    voices = client.get("/api/tavus/voices", headers=headers)
    assert voices.status_code == 200
    no_face = client.put("/api/tavus/profile", headers=headers, json={"displayName": "Ada"})
    assert no_face.status_code == 400
    assert "voice and a face" in no_face.text
    cleared = client.delete("/api/tavus/credential", headers=headers)
    assert cleared.status_code == 200
    assert cleared.json()["configured"] is False
    blocked = client.post("/api/tavus/conversations", headers=headers, json={})
    assert blocked.status_code == 400
    assert "Tools & Keys" in blocked.text


def test_a_new_key_does_not_reuse_a_personality_from_another_account(client, monkeypatch):
    headers, user_id = _headers(client)
    calls: list[tuple[str, str]] = []
    monkeypatch.setattr("app.tavus_profile.request", _fake_tavus(calls))
    monkeypatch.setattr("app.tavus_knowledge.tavus_request", _fake_tavus(calls))
    now = "2026-10-05T10:00:00+00:00"
    db.execute(
        """
        INSERT INTO tavus_profiles (user_id, pal_id, display_name, created_at, updated_at)
        VALUES (?, 'pal_shared', 'Ada', ?, ?)
        """,
        (user_id, now, now),
    )
    _grant_key(client, headers)
    saved = client.put("/api/tavus/profile", headers=headers, json=_PROFILE)
    assert saved.status_code == 200, saved.text
    assert saved.json()["palId"] == "pal_user"
    assert not any(path == "/v2/pals/pal_shared" for _method, path in calls)


def test_request_uses_the_stored_user_key(client, monkeypatch):
    headers, user_id = _headers(client)
    _grant_key(client, headers, "user-tavus-key")
    monkeypatch.setenv("TAVUS_API_KEY", "server-should-not-be-used")
    seen: dict[str, str] = {}

    class Response:
        status_code = 200
        content = b'{"ok": true}'

        def json(self):
            return {"ok": True}

    def fake_request(method, url, headers=None, json=None, timeout=None):
        seen["key"] = (headers or {})["x-api-key"]
        return Response()

    monkeypatch.setattr("app.tavus_client.httpx.request", fake_request)
    from app.tavus_client import request
    from app.tavus_keys import using_user

    with using_user(user_id):
        request("GET", "/v2/voices")
    assert seen["key"] == "user-tavus-key"


def test_chat_personality_does_not_hand_work_to_the_video_call():
    from app.tavus_profile import chat_personality, spoken_prompt

    spoken = spoken_prompt("Donatus", "professional and friendly", "never be rude")
    chat = chat_personality("Donatus", "professional and friendly", "never be rude")

    assert "verxio_start_task" in spoken
    assert spoken.count("verxio_start_task") == 1
    assert "verxio_start_task" not in chat
    assert "this chat" in chat
    assert "never be rude" in chat
