from __future__ import annotations

from subprocess import CompletedProcess

from app import runtime_manager
from app.models import RuntimeInstance


def _runtime() -> RuntimeInstance:
    return RuntimeInstance(
        id="rt-1",
        tenant_id="tenant-1",
        workspace_id="ws-1",
        agent_id="agent-1",
        mode="local-docker",
        status="running",
        container_name="verxio-ws-1-agent-1",
        dashboard_url="http://172.17.0.1:19119",
        hermes_home_path="/tmp/verxio/hermes-home",
        workspace_path="/tmp/verxio/workspace",
        artifact_path="/tmp/verxio/workspace/artifacts",
    )


def _reset_network_cache() -> None:
    runtime_manager._NETWORK_CACHE = None
    runtime_manager._NETWORK_CACHE_LOADED = False
    runtime_manager._NETWORK_ATTACHED_CACHE.clear()


def test_runtime_dashboard_base_url_prefers_configured_compose_network(monkeypatch):
    _reset_network_cache()
    monkeypatch.setenv("VERXIO_RUNTIME_DOCKER_NETWORK", "verxio-ai_default")

    assert runtime_manager.runtime_dashboard_base_url(_runtime(), ensure_network=False) == (
        "http://verxio-ws-1-agent-1:9119"
    )


def test_ensure_runtime_on_network_connects_once(monkeypatch):
    _reset_network_cache()
    monkeypatch.setenv("VERXIO_RUNTIME_DOCKER_NETWORK", "verxio-ai_default")
    calls: list[list[str]] = []

    def fake_run_docker(args: list[str]) -> CompletedProcess[str]:
        calls.append(args)
        if args[:1] == ["inspect"]:
            return CompletedProcess(args, 0, stdout="<no value>\n", stderr="")
        if args[:2] == ["network", "connect"]:
            return CompletedProcess(args, 0, stdout="", stderr="")
        raise AssertionError(f"Unexpected docker call: {args}")

    monkeypatch.setattr(runtime_manager, "_run_docker", fake_run_docker)

    runtime_manager._ensure_runtime_on_network(_runtime())
    runtime_manager._ensure_runtime_on_network(_runtime())

    assert calls == [
        [
            "inspect",
            "-f",
            '{{index .NetworkSettings.Networks "verxio-ai_default"}}',
            "verxio-ws-1-agent-1",
        ],
        ["network", "connect", "verxio-ai_default", "verxio-ws-1-agent-1"],
    ]
