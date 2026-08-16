from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import control_plane, db, emailer, micromgr, workflow_agents
from app.control_plane import agent_from_row, workspace_from_row
from app.auth import SESSION_COOKIE
from app.main import app
from tests.test_api import signup


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("VERXIO_DATABASE_MODE", "sqlite")
    monkeypatch.setenv("VERXIO_DATABASE_PATH", str(tmp_path / "verxio-control.sqlite3"))
    monkeypatch.setenv("VERXIO_RUNTIME_MODE", "demo")
    monkeypatch.setenv("VERXIO_WORKFLOW_SCHEDULER_ENABLED", "0")
    monkeypatch.setenv("VERXIO_IDLE_REAPER_ENABLED", "0")
    monkeypatch.setenv("VERXIO_AUTH_CODE_SECRET", "test-auth-code-secret")
    monkeypatch.delenv("VERXIO_SMTP_HOST", raising=False)
    monkeypatch.delenv("VERXIO_SMTP_FROM", raising=False)
    monkeypatch.setattr(control_plane, "RUNTIME_ROOT", tmp_path / "runtimes")

    async def fake_enqueue_wake(*_args, **_kwargs):
        return True

    monkeypatch.setattr("app.runtime_orch.lifecycle.enqueue_wake", fake_enqueue_wake)
    emailer.SENT_AUTH_EMAILS.clear()
    db.run_migrations()
    from app.runtime_orch.wake_queue import reset_wake_queue_for_tests

    reset_wake_queue_for_tests()

    with TestClient(app) as test_client:
        yield test_client


def _headers(token: str) -> dict[str, str]:
    return {"Cookie": f"{SESSION_COOKIE}={token}"}


def _create_from_template(client, token: str, template: str, name: str | None = None) -> dict:
    payload: dict[str, str] = {"template": template}
    if name:
        payload["name"] = name
    created = client.post("/api/workflow-agents/from-template", headers=_headers(token), json=payload)
    assert created.status_code == 200, created.text
    return created.json()


def _bind_chat(client, token: str, agent_id: str, connection_id: str) -> None:
    triggers = client.get(f"/api/workflow-agents/{agent_id}/triggers", headers=_headers(token)).json()["triggers"]
    chat = next(item for item in triggers if item["trigger_type"] == "chat")
    bound = client.put(
        f"/api/workflow-agents/{agent_id}/triggers/{chat['id']}",
        headers=_headers(token),
        json={"enabled": True, "config": {"connectionId": connection_id, "requireConnection": True}},
    )
    assert bound.status_code == 200, bound.text


def _message(
    client,
    token: str,
    *,
    connection_id: str,
    sender_id: str,
    message: str,
    channel: str = "telegram",
    media_urls: list[str] | None = None,
) -> dict:
    payload = {
        "channel": channel,
        "connection_id": connection_id,
        "conversation_id": sender_id,
        "sender_id": sender_id,
        "sender_name": "Ada",
        "message": message,
        "event_name": "message.received",
        "input": {
            "media_urls": media_urls or [],
            "image_url": (media_urls or [""])[0] if media_urls else "",
        },
    }
    response = client.post("/api/workflow-agents/triggers/messaging", headers=_headers(token), json=payload)
    assert response.status_code == 200, response.text
    runs = response.json()["runs"]
    assert runs, response.text
    return runs[0]


def test_create_micromgr_from_template(client):
    _payload, token = signup(client, "micromgr-template@example.com")
    agent = _create_from_template(client, token, "micromgr")
    assert agent["name"] == "Micro-Manager"
    assert agent["role"] == "Operations manager"
    assert "micromgr" in agent["tags"]
    assert "default" not in agent["tags"]
    assert "Isaac" in agent["instructions"]

    triggers = client.get(f"/api/workflow-agents/{agent['id']}/triggers", headers=_headers(token))
    assert triggers.status_code == 200
    chat = next(item for item in triggers.json()["triggers"] if item["trigger_type"] == "chat")
    assert chat["config"].get("requireConnection") is True

    deliveries = client.get(f"/api/workflow-agents/{agent['id']}/deliveries", headers=_headers(token))
    assert any(item["delivery_type"] == "reply_to_source" for item in deliveries.json()["deliveries"])


def test_micromgr_ready_submit_vet_and_miss(client, monkeypatch):
    _payload, token = signup(client, "micromgr-loop@example.com")
    headers = _headers(token)
    sent: list[dict] = []

    async def fake_oneshot(_workspace, _profile, user_input, *, instructions=None, images=None):
        if instructions and "Evidence evaluation" in str(instructions):
            assert "https://files.example/kitchen.jpg" in str(user_input)
            assert images == ["https://files.example/kitchen.jpg"]
            return '{"score": 88, "passed": true, "findings": ["Counters are clean"], "summary": "Kitchen looks ready."}'
        if instructions and "Daily compliance report" in str(instructions):
            return "## Worker Review\nAda submitted on time.\n"
        return str(user_input)

    async def fake_send(_workspace, _profile, *, platform, connection_id, destination, message):
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
    monkeypatch.setattr(micromgr, "run_agent_via_dashboard", fake_oneshot)
    monkeypatch.setattr(micromgr, "send_message_via_dashboard", fake_send)
    monkeypatch.setattr(workflow_agents, "send_message_via_dashboard", fake_send)

    agent = _create_from_template(client, token, "micromgr")
    _bind_chat(client, token, agent["id"], "tg-1")

    created = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/tasks",
        headers=headers,
        json={
            "name": "Morning kitchen inspection",
            "description": "Photo of a clean kitchen.",
            "scheduled_times": ["09:00"],
            "timezone": "UTC",
            "passing_score": 70,
            "grace_minutes": 15,
            "acceptance_rules": ["Counters wiped", "Floor dry"],
            "report_time": "18:00",
            "delivery_config": {
                "destinations": [
                    {"platform": "telegram", "destination": "99", "connection_id": "tg-1"},
                    {"platform": "email", "destination": "ops@example.com", "connection_id": "gmail-1"},
                ]
            },
        },
    )
    assert created.status_code == 200, created.text
    task = created.json()
    assert task["name"] == "Morning kitchen inspection"

    worker = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/workers",
        headers=headers,
        json={
            "task_id": task["id"],
            "name": "Ada",
            "platform": "telegram",
            "external_id": "42",
            "connection_id": "tg-1",
        },
    )
    assert worker.status_code == 200, worker.text
    assert worker.json()["status"] == "onboarding"
    assert sum(1 for item in sent if "reply with Ready" in item["message"]) == 1

    worker_row = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (worker.json()["id"],))
    task_row = db.fetch_one("SELECT * FROM micromgr_tasks WHERE id = ?", (task["id"],))
    ws_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (worker_row["workspace_id"],))
    agent_row = db.fetch_one(
        "SELECT * FROM agents WHERE id = (SELECT runtime_agent_id FROM workflow_agents WHERE id = ?)",
        (agent["id"],),
    )
    assert worker_row is not None and task_row is not None and ws_row is not None and agent_row is not None
    asyncio.run(
        micromgr._send_onboarding(workspace_from_row(ws_row), agent_from_row(agent_row), worker_row, task_row)
    )
    asyncio.run(
        micromgr._send(
            workspace_from_row(ws_row),
            agent_from_row(agent_row),
            platform="telegram",
            connection_id="tg-1",
            destination="42",
            message=micromgr._onboarding_message(worker_row, task_row),
        )
    )
    assert sum(1 for item in sent if "reply with Ready" in item["message"]) == 1

    outbound_before_ready = len(sent)
    ready = _message(client, token, connection_id="tg-1", sender_id="42", message="Ready")
    assert "You're now active" in ready["output_text"]
    assert len(sent) == outbound_before_ready
    workers = client.get(f"/api/workflow-agents/{agent['id']}/micromgr/workers", headers=headers)
    assert workers.json()["workers"][0]["status"] == "active"

    help_reply = _message(client, token, connection_id="tg-1", sender_id="42", message="help")
    assert "Morning kitchen inspection" in help_reply["output_text"]
    assert "Passing score: 70/100" in help_reply["output_text"]
    assert len(sent) == outbound_before_ready

    frozen = datetime(2026, 8, 14, 9, 5, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            value = frozen
            return value if tz is None else value.astimezone(tz)

    monkeypatch.setattr(micromgr, "datetime", FrozenDateTime)
    tick = client.post("/api/workflow-agents/triggers/schedules/tick", headers=headers)
    assert tick.status_code == 200, tick.text
    reminder = next(item for item in sent if "is due at 09:00" in item["message"])
    assert reminder["platform"] == "telegram"
    assert reminder["destination"] == "42"
    assert reminder["connection_id"] == "tg-1"

    photo = _message(
        client,
        token,
        connection_id="tg-1",
        sender_id="42",
        message="kitchen",
        media_urls=["https://files.example/kitchen.jpg"],
    )
    assert "Score: 88/100" in photo["output_text"]
    assert "Passed" in photo["output_text"]

    liveboard = client.get(f"/api/workflow-agents/{agent['id']}/micromgr/liveboard", headers=headers)
    assert liveboard.status_code == 200
    assert liveboard.json()["total"] == 1
    assert liveboard.json()["submissions"][0]["status"] == "approved"
    assert liveboard.json()["submissions"][0]["ai_score"] == 88

    second = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/workers",
        headers=headers,
        json={
            "task_id": task["id"],
            "name": "Bola",
            "platform": "telegram",
            "external_id": "43",
            "connection_id": "tg-1",
        },
    )
    assert second.status_code == 200
    _message(client, token, connection_id="tg-1", sender_id="43", message="Ready")
    bola = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (second.json()["id"],))
    assert bola is not None
    due_at = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    db.execute(
        """
        INSERT INTO micromgr_submissions (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, worker_id, due_at, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (
            "micromgr_sub_missed1",
            bola["tenant_id"],
            bola["workspace_id"],
            agent["id"],
            task["id"],
            bola["id"],
            due_at,
            due_at,
            due_at,
        ),
    )
    monkeypatch.setattr(micromgr, "datetime", datetime)
    miss_tick = client.post("/api/workflow-agents/triggers/schedules/tick", headers=headers)
    assert miss_tick.status_code == 200, miss_tick.text
    flags = client.get(f"/api/workflow-agents/{agent['id']}/micromgr/flags", headers=headers)
    assert flags.status_code == 200
    assert flags.json()["total"] >= 1
    assert any(item["reason_type"] == "missed_deadline" for item in flags.json()["flags"])
    assert any("you missed" in item["message"].lower() for item in sent)

    report = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/tasks/{task['id']}/report",
        headers=headers,
    )
    assert report.status_code == 200, report.text
    assert "Worker Review" in report.json()["summary_markdown"]
    delivered = report.json()["delivered_to"]
    assert delivered.get("telegram:99") is True
    assert delivered.get("email:ops@example.com") is True
    listed = client.get(f"/api/workflow-agents/{agent['id']}/micromgr/reports", headers=headers)
    assert listed.json()["total"] >= 1


def _seed_active_kitchen_worker(client, token: str, monkeypatch) -> tuple[dict, dict, list[dict], list[dict]]:
    headers = _headers(token)
    sent: list[dict] = []
    vet_calls: list[dict] = []

    async def fake_oneshot(_workspace, _profile, user_input, *, instructions=None, images=None):
        vet_calls.append({"input": user_input, "instructions": instructions, "images": images})
        return '{"score": 10, "passed": false, "findings": ["should not run"], "summary": "scored"}'

    async def fake_send(_workspace, _profile, *, platform, connection_id, destination, message):
        sent.append({"platform": platform, "destination": destination, "message": message})
        return {"success": True, "message_id": "msg_1"}

    monkeypatch.setattr(workflow_agents, "run_agent_via_dashboard", fake_oneshot)
    monkeypatch.setattr(micromgr, "run_agent_via_dashboard", fake_oneshot)
    monkeypatch.setattr(micromgr, "send_message_via_dashboard", fake_send)
    monkeypatch.setattr(workflow_agents, "send_message_via_dashboard", fake_send)

    agent = _create_from_template(client, token, "micromgr")
    _bind_chat(client, token, agent["id"], "tg-1")
    task = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/tasks",
        headers=headers,
        json={
            "name": "Morning kitchen inspection",
            "scheduled_times": ["09:00"],
            "timezone": "UTC",
            "passing_score": 70,
            "acceptance_rules": ["Counters wiped"],
        },
    ).json()
    worker = client.post(
        f"/api/workflow-agents/{agent['id']}/micromgr/workers",
        headers=headers,
        json={
            "task_id": task["id"],
            "name": "Ada",
            "platform": "telegram",
            "external_id": "42",
            "connection_id": "tg-1",
        },
    ).json()
    return agent, worker, sent, vet_calls


def test_ready_is_never_scored_as_evidence(client, monkeypatch):
    _payload, token = signup(client, "micromgr-ready@example.com")
    agent, worker, _sent, vet_calls = _seed_active_kitchen_worker(client, token, monkeypatch)

    ready = _message(client, token, connection_id="tg-1", sender_id="42", message="Ready")
    assert "You're now active" in ready["output_text"]
    assert vet_calls == []

    db.execute("UPDATE micromgr_workers SET status = 'active' WHERE id = ?", (worker["id"],))
    row = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (worker["id"],))
    assert row is not None
    db.execute(
        """
        INSERT INTO micromgr_submissions (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, worker_id, due_at, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (
            "micromgr_sub_ready1",
            row["tenant_id"],
            row["workspace_id"],
            agent["id"],
            worker["task_id"],
            worker["id"],
            datetime.now(timezone.utc).isoformat(),
            datetime.now(timezone.utc).isoformat(),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    again = _message(client, token, connection_id="tg-1", sender_id="42", message="Ready")
    assert "already onboarded" in again["output_text"]
    assert "Score:" not in again["output_text"]
    assert vet_calls == []


def test_photo_task_asks_for_photo_instead_of_scoring_text(client, monkeypatch):
    _payload, token = signup(client, "micromgr-photo@example.com")
    agent, worker, _sent, vet_calls = _seed_active_kitchen_worker(client, token, monkeypatch)
    _message(client, token, connection_id="tg-1", sender_id="42", message="Ready")
    row = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (worker["id"],))
    assert row is not None
    db.execute(
        """
        INSERT INTO micromgr_submissions (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, worker_id, due_at, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (
            "micromgr_sub_text1",
            row["tenant_id"],
            row["workspace_id"],
            agent["id"],
            worker["task_id"],
            worker["id"],
            datetime.now(timezone.utc).isoformat(),
            datetime.now(timezone.utc).isoformat(),
            datetime.now(timezone.utc).isoformat(),
        ),
    )
    reply = _message(client, token, connection_id="tg-1", sender_id="42", message="kitchen is clean")
    assert "needs a photo" in reply["output_text"]
    assert "Score:" not in reply["output_text"]
    assert vet_calls == []


def test_onboarding_blocks_evidence_until_ready(client, monkeypatch):
    _payload, token = signup(client, "micromgr-onboard@example.com")
    _agent, _worker, _sent, vet_calls = _seed_active_kitchen_worker(client, token, monkeypatch)
    photo = _message(
        client,
        token,
        connection_id="tg-1",
        sender_id="42",
        message="kitchen",
        media_urls=["https://files.example/kitchen.jpg"],
    )
    assert "reply with Ready" in photo["output_text"]
    assert vet_calls == []
