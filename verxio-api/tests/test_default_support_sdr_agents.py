from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import control_plane, db, emailer
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
    from app import workflow_agents

    _payload, token = signup(client, "default-support-runtime@example.com")
    headers = _headers(token)
    calls: list[str] = []
    seen: dict[str, str] = {}

    async def fake_oneshot(workspace, profile, user_input, *, instructions=None):
        calls.append("model")
        seen["instructions"] = str(instructions)
        return "VIP returns are covered.\n\n[SUGGEST_RATING]"

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
