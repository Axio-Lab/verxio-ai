from __future__ import annotations

from app.models import AgentProfile, AuditEvent, RunRecord, Workspace


WORKSPACE = Workspace(
    id="local-verxio",
    name="Verxio Local",
    region="Local",
    plan="Hermes runtime skin",
)


PROFILE = AgentProfile(
    id="verxio-agent",
    name="Verxio Agent",
    role="Hermes-powered assistant",
    status="active",
    description=(
        "A Verxio interface over the local Hermes Agent runtime: chat, tools, memory, "
        "skills, MCP servers, scheduled jobs, and configured gateway connections."
    ),
    capabilities=[
        "Use the model/provider configured in Hermes",
        "Run Hermes tools and MCP servers exposed to the API server",
        "Use Hermes memory and skills when enabled in the runtime",
        "Track submitted runs without freezing the Verxio UI",
        "Surface Hermes runtime metadata for setup and debugging",
    ],
    starters=[
        "Help me understand this project and decide what to build next.",
        "Use the available Hermes tools to inspect my current workspace.",
        "Create a reusable plan for a task I repeat every week.",
    ],
)


AUDIT_LOG: list[AuditEvent] = [
    AuditEvent(
        agent_id=PROFILE.id,
        actor="Verxio",
        action="runtime.skin.loaded",
        summary="Loaded Verxio as the interface for the local Hermes Agent runtime.",
        status="success",
        metadata={"runtime": "hermes-agent"},
    ),
]


RUNS: list[RunRecord] = []
