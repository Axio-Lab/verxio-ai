"""API route tests for scale lifecycle endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from app.main import app
from app.models import RuntimeInstance


def test_idle_policies_requires_auth():
    client = TestClient(app)
    assert client.get("/api/runtime/idle/policies").status_code in {401, 403}


def test_wake_drain_routes_exist_authenticated(monkeypatch):
    client = TestClient(app)

    user = {"id": "user_scale", "email": "scale@test.com", "name": "Scale"}
    runtime = RuntimeInstance(
        id="rt_scale",
        tenant_id="user_scale",
        workspace_id="ws_scale",
        agent_id="agent_scale",
        mode="local-docker",
        status="stopped",
        hermes_home_path="/tmp/h",
        workspace_path="/tmp/w",
        artifact_path="/tmp/a",
    )

    monkeypatch.setattr("app.main.require_user", lambda request: user)
    monkeypatch.setattr("app.main.get_runtime_for_user", lambda user, **kw: runtime)

    async def _noop(*_a, **_k):
        return None

    monkeypatch.setattr("app.main._sync_composio_bridge_for_user", _noop)
    monkeypatch.setattr("app.main._sync_inference_bridge_for_user", _noop)
    monkeypatch.setattr("app.main.runtime_env_for_user", lambda *_: {})

    async def fake_wake(rt, **kwargs):
        return rt.model_copy(update={"status": "running"})

    async def fake_drain(rt):
        return rt.model_copy(update={"status": "stopped"})

    async def fake_health(rt):
        return True, "ok"

    monkeypatch.setattr("app.main.wake_runtime", fake_wake)
    monkeypatch.setattr("app.main.drain_runtime", fake_drain)
    monkeypatch.setattr("app.main.runtime_health", fake_health)

    wake = client.post("/api/runtime/wake")
    assert wake.status_code == 200
    assert wake.json()["runtime"]["status"] == "running"

    drain = client.post("/api/runtime/drain")
    assert drain.status_code == 200
    assert drain.json()["runtime"]["status"] == "stopped"

    policies = client.get("/api/runtime/idle/policies")
    assert policies.status_code == 200
    body = policies.json()
    assert "policies" in body
    assert body["active"]
