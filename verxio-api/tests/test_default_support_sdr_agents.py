from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import control_plane, db, emailer, workflow_agents
from app.auth import SESSION_COOKIE
from app.main import app
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


def _headers(token: str) -> dict[str, str]:
    return {"Cookie": f"{SESSION_COOKIE}={token}"}


def _listed_agents(client, token: str) -> list[dict]:
    listed = client.get("/api/workflow-agents", headers=_headers(token))
    assert listed.status_code == 200
    return listed.json()["agents"]


def _by_name(agents: list[dict], name: str) -> dict:
    return next(item for item in agents if item["name"] == name)


def test_default_support_and_sdr_agents_are_seeded_idempotently(client):
    _payload, token = signup(client, "default-agents-seed@example.com")
    first = _listed_agents(client, token)
    support = _by_name(first, "Customer Support")
    sdr = _by_name(first, "SDR")
    assert support["origin"] == "system"
    assert sdr["origin"] == "system"
    assert "default" in support["tags"]
    assert "customer-support" in support["tags"]
    assert "default" in sdr["tags"]
    assert "sdr" in sdr["tags"]
    assert support["role"] == "Customer support"
    assert sdr["role"] == "Sales development"

    embed = client.get(f"/api/workflow-agents/{support['id']}/embed", headers=_headers(token))
    assert embed.status_code == 200
    assert embed.json()["enabled"] is True
    assert embed.json()["welcome_message"] == "How can I help?"

    support_triggers = client.get(f"/api/workflow-agents/{support['id']}/triggers", headers=_headers(token))
    chat = next(item for item in support_triggers.json()["triggers"] if item["trigger_type"] == "chat")
    assert chat["config"].get("requireConnection") is True
    assert not chat["config"].get("connectionId")

    deliveries = client.get(f"/api/workflow-agents/{support['id']}/deliveries", headers=_headers(token))
    assert any(item["delivery_type"] == "reply_to_source" for item in deliveries.json()["deliveries"])

    second = _listed_agents(client, token)
    assert {item["id"] for item in second if item["origin"] == "system"} == {support["id"], sdr["id"]}


def test_support_embed_uses_knowledge_and_rating_skips_model(client, monkeypatch):
    _payload, token = signup(client, "default-support-runtime@example.com")
    headers = _headers(token)
    calls: list[str] = []

    async def fake_oneshot(workspace, profile, user_input, *, instructions=None):
        calls.append("model")
        seen["instructions"] = str(instructions)
        return "VIP returns are covered.\n\n[SUGGEST_RATING]"

    seen: dict[str, str] = {}
    monkeypatch.setattr(workflow_agents, "run_agent_via_dashboard", fake_oneshot)

    support = _by_name(_listed_agents(client, token), "Customer Support")
    knowledge_base = client.post("/api/knowledge-bases", headers=headers, json={"name": "Returns", "description": "Policy"}).json()
    document = client.post(
        f"/api/knowledge-bases/{knowledge_base['id']}/documents",
        headers=headers,
        json={"title": "Return policy", "source": "manual", "content": "VIP customers can return damaged shoes within 45 days."},
    )
    assert document.status_code == 200
    updated = client.put(
        f"/api/workflow-agents/{support['id']}",
        headers=headers,
        json={"knowledge": [knowledge_base["id"]], "fallback_email": "help@example.com"},
    )
    assert updated.status_code == 200

    embed = client.get(f"/api/workflow-agents/{support['id']}/embed", headers=headers).json()
    run = client.post(
        f"/api/public/workflow-agents/{embed['public_token']}/runs",
        json={"message": "Can a VIP return damaged shoes?", "visitor_id": "visitor_support"},
    )
    assert run.status_code == 200
    assert "damaged shoes" in seen["instructions"]
    assert "help@example.com" in seen["instructions"]
    assert "[SUGGEST_RATING]" not in run.json()["run"]["output_text"]
    assert "VIP returns" in run.json()["run"]["output_text"]
    assert calls == ["model"]

    async def fail_if_called(*_args, **_kwargs):
        raise AssertionError("rating replies must not call the model")

    monkeypatch.setattr(workflow_agents, "run_agent_via_dashboard", fail_if_called)
    rated = client.post(
        f"/api/public/workflow-agents/{embed['public_token']}/runs",
        json={"message": "5", "visitor_id": "visitor_support"},
    )
    assert rated.status_code == 200
    assert "Thank you for your feedback" in rated.json()["run"]["output_text"]
    assert calls == ["model"]


def test_sdr_funnel_collects_answers_and_dispatches_follow_up(client, monkeypatch):
    _payload, token = signup(client, "default-sdr-funnel@example.com")
    headers = _headers(token)
    sent: list[dict] = []

    async def fake_oneshot(workspace, profile, user_input, *, instructions=None):
        return str(user_input)

    async def fake_send(workspace, profile, *, platform, connection_id, destination, message):
        sent.append(
            {
                "platform": platform,
                "connection_id": connection_id,
                "destination": destination,
                "message": message,
            }
        )
        return {"success": True, "message_id": "msg_1"}

    monkeypatch.setattr(workflow_agents, "run_agent_via_dashboard", fake_oneshot)
    monkeypatch.setattr("app.sdr_funnel.run_agent_via_dashboard", fake_oneshot)
    monkeypatch.setattr("app.sdr_funnel.send_message_via_dashboard", fake_send)
    monkeypatch.setattr(workflow_agents, "send_message_via_dashboard", fake_send)

    sdr = _by_name(_listed_agents(client, token), "SDR")
    updated = client.put(
        f"/api/workflow-agents/{sdr['id']}",
        headers=headers,
        json={
            "funnel_rules": {
                "rules": [
                    {
                        "id": "pricing",
                        "triggers": ["pricing"],
                        "questionsEnabled": True,
                        "questions": ["What is your company size?", "When do you want to start?"],
                        "summary": "Here is the pricing guide for {{answer1}} teams.",
                        "assetUrl": "https://example.com/pricing.pdf",
                        "assetLabel": "Pricing guide",
                        "followUpEnabled": True,
                        "followUps": [
                            {
                                "message": "Still want the pricing guide?",
                                "useCustomMessage": True,
                                "delayMinutes": 30,
                            }
                        ],
                    }
                ]
            }
        },
    )
    assert updated.status_code == 200

    triggers = client.get(f"/api/workflow-agents/{sdr['id']}/triggers", headers=headers).json()["triggers"]
    chat = next(item for item in triggers if item["trigger_type"] == "chat")
    bound = client.put(
        f"/api/workflow-agents/{sdr['id']}/triggers/{chat['id']}",
        headers=headers,
        json={"enabled": True, "config": {"connectionId": "wa-1", "requireConnection": True}},
    )
    assert bound.status_code == 200

    first = client.post(
        "/api/workflow-agents/triggers/messaging",
        headers=headers,
        json={
            "channel": "whatsapp",
            "connection_id": "wa-1",
            "conversation_id": "15550001111",
            "sender_id": "15550001111",
            "sender_name": "Ada",
            "message": "Need pricing details",
            "event_name": "message.received",
        },
    )
    assert first.status_code == 200
    assert first.json()["runs"][0]["output_text"] == "What is your company size?"

    second = client.post(
        "/api/workflow-agents/triggers/messaging",
        headers=headers,
        json={
            "channel": "whatsapp",
            "connection_id": "wa-1",
            "conversation_id": "15550001111",
            "sender_id": "15550001111",
            "sender_name": "Ada",
            "message": "about 50 people",
            "event_name": "message.received",
        },
    )
    assert second.status_code == 200
    assert "When do you want to start?" in second.json()["runs"][0]["output_text"]

    contacts = client.get(f"/api/workflow-agents/{sdr['id']}/sdr-contacts", headers=headers)
    assert contacts.status_code == 200
    assert contacts.json()["total"] == 1
    assert contacts.json()["contacts"][0]["sender_name"] == "Ada"

    export = client.get(f"/api/workflow-agents/{sdr['id']}/sdr-contacts/export", headers=headers)
    assert export.status_code == 200
    assert "BEGIN:VCARD" in export.json()["vcf"]

    session = db.fetch_one(
        "SELECT * FROM sdr_sessions WHERE workflow_agent_id = ? AND conversation_id = ?",
        (sdr["id"], "15550001111"),
    )
    assert session is not None
    assert session["follow_up_next_fire_at"]
    db.execute(
        "UPDATE sdr_sessions SET follow_up_next_fire_at = ? WHERE id = ?",
        ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), session["id"]),
    )

    tick = client.post("/api/workflow-agents/triggers/schedules/tick", headers=headers)
    assert tick.status_code == 200
    assert any("Still want the pricing guide?" in item["message"] for item in sent)
    follow_up = next(item for item in sent if "Still want the pricing guide?" in item["message"])
    assert follow_up["platform"] == "whatsapp"
    assert follow_up["connection_id"] == "wa-1"
