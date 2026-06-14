from __future__ import annotations

from app import control_plane
from app.leash_agent import clear_leash_agent, leash_agent_path, read_leash_agent, write_leash_agent
from app.models import RuntimeInstance


def test_leash_agent_round_trip(tmp_path, monkeypatch):
    monkeypatch.setattr(control_plane, "RUNTIME_ROOT", tmp_path / "runtimes")
    runtime = RuntimeInstance(
        id="rt_1",
        tenant_id="tenant_1",
        workspace_id="ws_1",
        agent_id="ag_1",
        mode="docker",
        status="stopped",
        hermes_home_path=str(tmp_path / "runtimes" / "ws_1" / "ag_1" / "hermes-home"),
        workspace_path=str(tmp_path / "runtimes" / "ws_1" / "ag_1" / "workspace"),
        artifact_path=str(tmp_path / "runtimes" / "ws_1" / "ag_1" / "workspace" / "artifacts"),
    )

    payload = {"version": 1, "agent_mint": "Agnt123", "executive_keypair": "secret"}
    write_leash_agent(runtime, payload)

    path = leash_agent_path(runtime)
    assert path.is_file()
    assert read_leash_agent(runtime) == payload

    clear_leash_agent(runtime)
    assert not path.is_file()
