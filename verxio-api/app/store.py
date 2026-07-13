from __future__ import annotations

from app.models import AgentProfile, AuditEvent, RunRecord, Workspace


WORKSPACE = Workspace(
    id="local-verxio",
    name="Verxio Local",
    region="Local",
    plan="Verxio runtime workspace",
)


PROFILE = AgentProfile(
    id="verxio-agent",
    name="Verxio Agent",
    role="Verxio assistant",
    status="active",
    description=(
        "A Verxio AI agent with local chat, connected tools, memory, skills, "
        "scheduled jobs, and messaging connections."
    ),
    capabilities=[
        "Use the model and provider configured in Verxio",
        "Run connected tools and apps exposed to Verxio",
        "Use memory and skills when enabled in the runtime",
        "Track submitted runs without freezing the Verxio UI",
        "Surface runtime readiness for setup and debugging",
    ],
    starters=[
        "Help me understand this project and decide what to build next.",
        "Use the available Verxio tools to inspect my current workspace.",
        "Create a reusable plan for a task I repeat every week.",
    ],
)


AUDIT_LOG: list[AuditEvent] = [
    AuditEvent(
        agent_id=PROFILE.id,
        actor="Verxio",
        action="runtime.skin.loaded",
        summary="Loaded Verxio as the interface for the local agent runtime.",
        status="success",
        metadata={"runtime": "hermes-agent"},
    ),
]


RUNS: list[RunRecord] = []
