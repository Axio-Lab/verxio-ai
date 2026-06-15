from __future__ import annotations

import asyncio

import pytest
from fastapi import HTTPException

from app.models import AgentProfile, Workspace
from app.runtime_dashboard import run_agent_via_dashboard


def _workspace() -> Workspace:
    return Workspace(
        id="ws-1",
        tenant_id="tenant-1",
        name="Workspace",
        slug="workspace",
        kind="personal",
        plan="free",
        region="local",
    )


def _profile() -> AgentProfile:
    return AgentProfile(
        id="agent-1",
        workspace_id="ws-1",
        tenant_id="tenant-1",
        name="Verxio Agent",
        role="assistant",
        status="active",
        description="",
        capabilities=[],
        starters=[],
    )


def test_run_agent_via_dashboard_returns_output(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"ok": True, "output": "Generated summary"}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, headers):
            assert url.endswith("/api/agent/oneshot")
            assert json["input"] == "Summarize this meeting."
            assert headers["Authorization"].startswith("Bearer ")
            return FakeResponse()

    async def fake_start_runtime(runtime):
        return runtime

    monkeypatch.setattr("app.runtime_dashboard.start_runtime", fake_start_runtime)
    monkeypatch.setattr(
        "app.runtime_dashboard.ensure_runtime_instance",
        lambda workspace, profile: type(
            "Runtime",
            (),
            {
                "id": "rt-1",
                "dashboard_url": "http://127.0.0.1:19119",
            },
        )(),
    )
    monkeypatch.setattr("app.runtime_dashboard.db.fetch_one", lambda *args, **kwargs: {"dashboard_token": "token-123"})
    monkeypatch.setattr("app.runtime_dashboard.httpx.AsyncClient", lambda timeout: FakeClient())

    output = asyncio.run(run_agent_via_dashboard(_workspace(), _profile(), "Summarize this meeting."))
    assert output == "Generated summary"


def test_run_agent_via_dashboard_rejects_empty_output(monkeypatch):
    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict[str, str]:
            return {"ok": True, "output": "   "}

    class FakeClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, exc_type, exc, tb):
            return False

        async def post(self, url, json, headers):
            return FakeResponse()

    async def fake_start_runtime(runtime):
        return runtime

    monkeypatch.setattr("app.runtime_dashboard.start_runtime", fake_start_runtime)
    monkeypatch.setattr(
        "app.runtime_dashboard.ensure_runtime_instance",
        lambda workspace, profile: type(
            "Runtime",
            (),
            {
                "id": "rt-1",
                "dashboard_url": "http://127.0.0.1:19119",
            },
        )(),
    )
    monkeypatch.setattr("app.runtime_dashboard.db.fetch_one", lambda *args, **kwargs: {"dashboard_token": "token-123"})
    monkeypatch.setattr("app.runtime_dashboard.httpx.AsyncClient", lambda timeout: FakeClient())

    with pytest.raises(HTTPException) as exc:
        asyncio.run(run_agent_via_dashboard(_workspace(), _profile(), "Summarize this meeting."))

    assert exc.value.status_code == 502
    assert "empty summary" in str(exc.value.detail).lower()
