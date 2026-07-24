from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.knowledge_bases import retrieve_context
from app.models import (
    AgentProfile,
    WorkflowAgentCreateRequest,
    WorkflowAgentRecord,
    WorkflowAgentsResponse,
    WorkflowAgentUpdateRequest,
    WorkflowIntegrationCapabilitiesResponse,
    WorkflowIntegrationCapability,
    WorkflowRunCreateRequest,
    WorkflowRunEventRecord,
    WorkflowRunEventsResponse,
    WorkflowRunRecord,
    WorkflowRunsResponse,
    WorkflowTriggerRunsResponse,
    WorkflowSkillCapabilitiesResponse,
    WorkflowSkillCapability,
    WorkflowToolCapabilitiesResponse,
    WorkflowToolCapability,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerRecord,
    WorkflowTriggersResponse,
    WorkflowTriggerUpdateRequest,
    Workspace,
    new_id,
)
from app.composio_catalog import (
    get_composio_catalog_error,
    is_composio_configured,
    list_composio_accounts,
    list_composio_apps,
)
from app.runtime import HermesRuntimeAdapter
from app.runtime_dashboard import run_agent_via_dashboard


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _parse_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _string_list(value: list[str] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in value or []:
        text = str(item).strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def _secret() -> str:
    return secrets.token_urlsafe(24)


def _agent_from_row(row: dict[str, Any]) -> WorkflowAgentRecord:
    payload = dict(row)
    payload["enabled"] = bool(payload.get("enabled"))
    payload["skills"] = _json_loads(payload.pop("skills_json", "[]"), [])
    payload["knowledge"] = _json_loads(payload.pop("knowledge_json", "[]"), [])
    payload["tools"] = _json_loads(payload.pop("tools_json", "[]"), [])
    payload["integrations"] = _json_loads(payload.pop("integrations_json", "[]"), [])
    return WorkflowAgentRecord(**payload)


def _trigger_from_row(row: dict[str, Any], request: Request | None = None) -> WorkflowTriggerRecord:
    payload = dict(row)
    payload["enabled"] = bool(payload.get("enabled"))
    payload["config"] = _json_loads(payload.pop("config_json", "{}"), {})
    webhook_url = None
    if request and payload.get("trigger_type") == "webhook":
        webhook_url = str(request.url_for("ingest_workflow_webhook_route", trigger_id=payload["id"]))
    payload["webhook_url"] = webhook_url
    return WorkflowTriggerRecord(**payload)


def _run_from_row(row: dict[str, Any]) -> WorkflowRunRecord:
    payload = dict(row)
    payload["input"] = _json_loads(payload.pop("input_json", "{}"), {})
    return WorkflowRunRecord(**payload)


def _event_from_row(row: dict[str, Any]) -> WorkflowRunEventRecord:
    payload = dict(row)
    payload["metadata"] = _json_loads(payload.pop("metadata_json", "{}"), {})
    return WorkflowRunEventRecord(**payload)


def _validate_trigger_payload(trigger_type: str, event_name: str, config: dict[str, Any]) -> None:
    if trigger_type == "webhook" and not event_name.strip():
        raise HTTPException(status_code=422, detail="Webhook triggers require an event name.")
    if trigger_type == "schedule":
        schedule = str(config.get("schedule") or config.get("cron") or "").strip()
        interval = int(config.get("intervalSeconds") or config.get("interval_seconds") or 0)
        minutes = int(config.get("everyMinutes") or config.get("every_minutes") or 0)
        if not schedule and interval <= 0 and minutes <= 0:
            raise HTTPException(
                status_code=422,
                detail="Schedule triggers require config.schedule, config.cron, config.everyMinutes, or config.intervalSeconds.",
            )
    if trigger_type == "app_event":
        app_slug = str(config.get("appSlug") or config.get("app_slug") or "").strip()
        event = str(config.get("event") or event_name or "").strip()
        if not app_slug or not event:
            raise HTTPException(status_code=422, detail="App event triggers require config.appSlug and an event name.")


def _record_run_event(
    run: WorkflowRunRecord,
    event_type: str,
    message: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO workflow_run_events (
            id, tenant_id, workspace_id, workflow_agent_id, workflow_run_id,
            event_type, message, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("workflow_event"),
            run.tenant_id,
            run.workspace_id,
            run.workflow_agent_id,
            run.id,
            event_type,
            message,
            _json_dumps(metadata or {}),
            now_iso(),
        ),
    )


def _skill_from_payload(item: Any) -> WorkflowSkillCapability | None:
    if isinstance(item, str):
        name = item.strip()
        return WorkflowSkillCapability(name=name) if name else None
    if not isinstance(item, dict):
        return None
    name = str(item.get("name") or item.get("id") or "").strip()
    if not name:
        return None
    return WorkflowSkillCapability(
        name=name,
        description=str(item.get("description") or item.get("summary") or ""),
        category=str(item.get("category") or item.get("source") or ""),
        enabled=bool(item.get("enabled", True)),
    )


def _tool_from_payload(item: Any, category: str = "") -> WorkflowToolCapability | None:
    if isinstance(item, str):
        name = item.strip()
        return WorkflowToolCapability(name=name, category=category) if name else None
    if not isinstance(item, dict):
        return None
    name = str(item.get("name") or item.get("id") or item.get("slug") or "").strip()
    if not name:
        return None
    return WorkflowToolCapability(
        name=name,
        description=str(item.get("description") or item.get("summary") or ""),
        category=str(item.get("category") or item.get("toolset") or category or item.get("source") or ""),
        source=str(item.get("source") or "hermes"),
        enabled=bool(item.get("enabled", True)),
    )


async def list_skill_capabilities() -> WorkflowSkillCapabilitiesResponse:
    metadata = await HermesRuntimeAdapter().metadata()
    skills = [skill for item in metadata.skills if (skill := _skill_from_payload(item))]
    skills.sort(key=lambda item: item.name.lower())
    return WorkflowSkillCapabilitiesResponse(skills=skills, errors=metadata.errors)


async def list_tool_capabilities() -> WorkflowToolCapabilitiesResponse:
    metadata = await HermesRuntimeAdapter().metadata()
    seen: set[str] = set()
    tools: list[WorkflowToolCapability] = []
    for item in metadata.toolsets:
        if isinstance(item, dict) and isinstance(item.get("tools"), list):
            category = str(item.get("name") or item.get("id") or item.get("slug") or "")
            candidates = item["tools"]
        else:
            category = ""
            candidates = [item]
        for candidate in candidates:
            tool = _tool_from_payload(candidate, category)
            if tool and tool.name not in seen:
                seen.add(tool.name)
                tools.append(tool)
    tools.sort(key=lambda item: (item.category.lower(), item.name.lower()))
    return WorkflowToolCapabilitiesResponse(tools=tools, errors=metadata.errors)


def list_integration_capabilities(user_id: str) -> WorkflowIntegrationCapabilitiesResponse:
    accounts = list_composio_accounts(user_id)
    connected = {account.appSlug.lower(): account for account in accounts if account.status.upper() == "ACTIVE"}
    integrations = [
        WorkflowIntegrationCapability(
            slug=app.slug,
            name=app.name,
            description=app.description,
            categories=app.categories,
            connected=True,
            authMode=app.authMode,
        )
        for app in list_composio_apps()
        if app.slug.lower() in connected
    ]
    integrations.sort(key=lambda item: item.name.lower())
    errors = [error] if (error := get_composio_catalog_error()) else []
    return WorkflowIntegrationCapabilitiesResponse(
        integrations=integrations,
        configured=is_composio_configured(),
        errors=errors,
    )


def list_agents(workspace: Workspace, profile: AgentProfile) -> WorkflowAgentsResponse:
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_agents
        WHERE workspace_id = ? AND runtime_agent_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id),
    )
    return WorkflowAgentsResponse(agents=[_agent_from_row(row) for row in rows])


def create_agent(workspace: Workspace, profile: AgentProfile, payload: WorkflowAgentCreateRequest) -> WorkflowAgentRecord:
    created_at = now_iso()
    agent_id = new_id("workflow_agent")
    db.execute(
        """
        INSERT INTO workflow_agents (
            id, tenant_id, workspace_id, runtime_agent_id, name, role, description,
            instructions, enabled, skills_json, knowledge_json, tools_json,
            integrations_json, approval_policy, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            agent_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            payload.name.strip(),
            payload.role.strip(),
            payload.description.strip(),
            payload.instructions.strip(),
            1 if payload.enabled else 0,
            _json_dumps(_string_list(payload.skills)),
            _json_dumps(_string_list(payload.knowledge)),
            _json_dumps(_string_list(payload.tools)),
            _json_dumps(_string_list(payload.integrations)),
            payload.approval_policy.strip() or "default",
            created_at,
            created_at,
        ),
    )
    return get_agent(workspace, profile, agent_id)


def get_agent(workspace: Workspace, profile: AgentProfile, agent_id: str) -> WorkflowAgentRecord:
    row = db.fetch_one(
        """
        SELECT * FROM workflow_agents
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (agent_id, workspace.id, profile.id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workflow agent not found.")
    return _agent_from_row(row)


def update_agent(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowAgentUpdateRequest,
) -> WorkflowAgentRecord:
    current = get_agent(workspace, profile, agent_id)
    data = current.model_dump()
    updates = payload.model_dump(exclude_unset=True)
    data.update({key: value for key, value in updates.items() if value is not None})
    db.execute(
        """
        UPDATE workflow_agents
        SET name = ?, role = ?, description = ?, instructions = ?, enabled = ?,
            skills_json = ?, knowledge_json = ?, tools_json = ?, integrations_json = ?,
            approval_policy = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (
            str(data["name"]).strip(),
            str(data.get("role") or "").strip(),
            str(data.get("description") or "").strip(),
            str(data.get("instructions") or "").strip(),
            1 if data.get("enabled") else 0,
            _json_dumps(_string_list(data.get("skills"))),
            _json_dumps(_string_list(data.get("knowledge"))),
            _json_dumps(_string_list(data.get("tools"))),
            _json_dumps(_string_list(data.get("integrations"))),
            str(data.get("approval_policy") or "default").strip(),
            now_iso(),
            agent_id,
            workspace.id,
            profile.id,
        ),
    )
    return get_agent(workspace, profile, agent_id)


def delete_agent(workspace: Workspace, profile: AgentProfile, agent_id: str) -> dict[str, bool]:
    get_agent(workspace, profile, agent_id)
    db.execute(
        "DELETE FROM workflow_agents WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?",
        (agent_id, workspace.id, profile.id),
    )
    return {"ok": True}


def list_triggers(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    request: Request | None = None,
) -> WorkflowTriggersResponse:
    get_agent(workspace, profile, agent_id)
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_triggers
        WHERE workspace_id = ? AND workflow_agent_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, agent_id),
    )
    return WorkflowTriggersResponse(triggers=[_trigger_from_row(row, request) for row in rows])


def create_trigger(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowTriggerCreateRequest,
    request: Request | None = None,
) -> WorkflowTriggerRecord:
    get_agent(workspace, profile, agent_id)
    _validate_trigger_payload(payload.trigger_type, payload.event_name, payload.config)
    created_at = now_iso()
    trigger_id = new_id("workflow_trigger")
    db.execute(
        """
        INSERT INTO workflow_triggers (
            id, tenant_id, workspace_id, workflow_agent_id, trigger_type, event_name,
            name, enabled, secret, config_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            trigger_id,
            workspace.tenant_id,
            workspace.id,
            agent_id,
            payload.trigger_type,
            payload.event_name.strip(),
            payload.name.strip(),
            1 if payload.enabled else 0,
            _secret() if payload.trigger_type == "webhook" else "",
            _json_dumps(payload.config),
            created_at,
            created_at,
        ),
    )
    return get_trigger(workspace, profile, agent_id, trigger_id, request)


def get_trigger(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    trigger_id: str,
    request: Request | None = None,
) -> WorkflowTriggerRecord:
    get_agent(workspace, profile, agent_id)
    row = db.fetch_one(
        """
        SELECT * FROM workflow_triggers
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (trigger_id, workspace.id, agent_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workflow trigger not found.")
    return _trigger_from_row(row, request)


def update_trigger(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    trigger_id: str,
    payload: WorkflowTriggerUpdateRequest,
    request: Request | None = None,
) -> WorkflowTriggerRecord:
    current = get_trigger(workspace, profile, agent_id, trigger_id, request)
    data = current.model_dump()
    updates = payload.model_dump(exclude_unset=True)
    data.update({key: value for key, value in updates.items() if value is not None and key != "rotate_secret"})
    _validate_trigger_payload(
        current.trigger_type,
        str(data.get("event_name") or ""),
        data.get("config") if isinstance(data.get("config"), dict) else {},
    )
    secret = _secret() if payload.rotate_secret and current.trigger_type == "webhook" else current.secret
    db.execute(
        """
        UPDATE workflow_triggers
        SET event_name = ?, name = ?, enabled = ?, secret = ?, config_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (
            str(data.get("event_name") or "").strip(),
            str(data.get("name") or "").strip(),
            1 if data.get("enabled") else 0,
            secret,
            _json_dumps(data.get("config") if isinstance(data.get("config"), dict) else {}),
            now_iso(),
            trigger_id,
            workspace.id,
            agent_id,
        ),
    )
    return get_trigger(workspace, profile, agent_id, trigger_id, request)


def delete_trigger(workspace: Workspace, profile: AgentProfile, agent_id: str, trigger_id: str) -> dict[str, bool]:
    get_trigger(workspace, profile, agent_id, trigger_id)
    db.execute(
        "DELETE FROM workflow_triggers WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?",
        (trigger_id, workspace.id, agent_id),
    )
    return {"ok": True}


def list_runs(workspace: Workspace, profile: AgentProfile, agent_id: str, limit: int = 50) -> WorkflowRunsResponse:
    get_agent(workspace, profile, agent_id)
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_runs
        WHERE workspace_id = ? AND workflow_agent_id = ?
        ORDER BY created_at DESC
        LIMIT ?
        """,
        (workspace.id, agent_id, max(1, min(limit, 100))),
    )
    return WorkflowRunsResponse(runs=[_run_from_row(row) for row in rows])


def list_run_events(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    run_id: str,
) -> WorkflowRunEventsResponse:
    get_agent(workspace, profile, agent_id)
    run = db.fetch_one(
        """
        SELECT id FROM workflow_runs
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (run_id, workspace.id, agent_id),
    )
    if not run:
        raise HTTPException(status_code=404, detail="Workflow run not found.")
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_run_events
        WHERE workflow_run_id = ?
        ORDER BY created_at ASC
        """,
        (run_id,),
    )
    return WorkflowRunEventsResponse(events=[_event_from_row(row) for row in rows])


def _create_run_row(
    workspace: Workspace,
    profile: AgentProfile,
    agent: WorkflowAgentRecord,
    trigger_type: str,
    input_payload: dict[str, Any],
    trigger_id: str | None = None,
) -> WorkflowRunRecord:
    created_at = now_iso()
    run_id = new_id("workflow_run")
    db.execute(
        """
        INSERT INTO workflow_runs (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id, trigger_id,
            trigger_type, status, input_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?)
        """,
        (
            run_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            agent.id,
            trigger_id,
            trigger_type,
            _json_dumps(input_payload),
            created_at,
            created_at,
        ),
    )
    run = _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)) or {})
    _record_run_event(run, "queued", "Workflow run was queued.", {"trigger_type": trigger_type, "trigger_id": trigger_id})
    return run


def _set_run_status(run_id: str, status: str, *, output: str = "", error: str | None = None, completed: bool = False) -> None:
    now = now_iso()
    db.execute(
        """
        UPDATE workflow_runs
        SET status = ?, output_text = ?, error = ?, started_at = COALESCE(started_at, ?),
            completed_at = CASE WHEN ? THEN ? ELSE completed_at END,
            updated_at = ?
        WHERE id = ?
        """,
        (status, output, error, now, 1 if completed else 0, now, now, run_id),
    )
    row = db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run_id,))
    if row:
        message = f"Workflow run {status}."
        metadata: dict[str, Any] = {}
        if error:
            metadata["error"] = error
        if output:
            metadata["outputPreview"] = output[:500]
        _record_run_event(_run_from_row(row), status, message, metadata)


def _build_instructions(agent: WorkflowAgentRecord, knowledge_context: list[dict[str, Any]] | None = None) -> str:
    skill_lines = [f"- {name}" for name in agent.skills]
    context_lines = [
        f"- {item['knowledge_base_name']} / {item['document_title']} chunk {item['chunk_index']}: {item['content']}"
        for item in knowledge_context or []
    ]
    parts = [
        f"You are the Verxio workflow agent named {agent.name}.",
        f"Role: {agent.role or 'Complete the assigned workflow run.'}",
        agent.instructions or "Complete the task using the provided event/input payload.",
        "Respect the per-agent setup below.",
        "Selected skills:\n" + ("\n".join(skill_lines) if skill_lines else "none"),
        f"Knowledge sources enabled: {', '.join(agent.knowledge) or 'none'}",
        "Retrieved knowledge context:\n" + ("\n".join(context_lines) if context_lines else "none"),
        f"Allowed tools: {', '.join(agent.tools) or 'default workspace tools'}",
        f"Allowed integrations: {', '.join(agent.integrations) or 'none explicitly selected'}",
        f"Approval policy: {agent.approval_policy}",
        "Return a concise final result describing what you did and any follow-up needed.",
    ]
    return "\n".join(part for part in parts if part.strip())


async def run_agent(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowRunCreateRequest,
    *,
    trigger_id: str | None = None,
    trigger_type: str = "manual",
) -> WorkflowRunRecord:
    agent = get_agent(workspace, profile, agent_id)
    if not agent.enabled:
        raise HTTPException(status_code=409, detail="Workflow agent is disabled.")
    run = _create_run_row(workspace, profile, agent, trigger_type, payload.input, trigger_id)
    _set_run_status(run.id, "running")
    knowledge_context = retrieve_context(workspace, agent.knowledge, payload.input)
    if knowledge_context:
        _record_run_event(
            run,
            "knowledge_retrieved",
            "Retrieved knowledge context for the workflow run.",
            {
                "chunks": [
                    {
                        "knowledgeBase": item["knowledge_base_name"],
                        "documentTitle": item["document_title"],
                        "chunkIndex": item["chunk_index"],
                        "score": item["score"],
                    }
                    for item in knowledge_context
                ]
            },
        )
    try:
        output = await run_agent_via_dashboard(
            workspace,
            profile,
            _json_dumps(
                {
                    "trigger_type": trigger_type,
                    "trigger_id": trigger_id,
                    "input": payload.input,
                    "knowledge_context": knowledge_context,
                }
            ),
            instructions=_build_instructions(agent, knowledge_context),
        )
    except Exception as exc:
        _set_run_status(run.id, "failed", error=str(exc), completed=True)
        return _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})
    _set_run_status(run.id, "completed", output=output, completed=True)
    return _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})


async def run_webhook_trigger(trigger_id: str, secret: str, payload: dict[str, Any]) -> WorkflowRunRecord:
    row = db.fetch_one(
        """
        SELECT t.*, a.runtime_agent_id
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE t.id = ? AND t.trigger_type = 'webhook'
        """,
        (trigger_id,),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workflow webhook trigger not found.")
    if not row.get("enabled"):
        raise HTTPException(status_code=409, detail="Workflow webhook trigger is disabled.")
    if not row.get("secret") or not secrets.compare_digest(str(row["secret"]), secret):
        raise HTTPException(status_code=403, detail="Invalid workflow webhook secret.")
    agent_row = db.fetch_one("SELECT * FROM workflow_agents WHERE id = ?", (row["workflow_agent_id"],))
    runtime_agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (row["runtime_agent_id"],))
    workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (row["workspace_id"],))
    if not agent_row or not runtime_agent_row or not workspace_row:
        raise HTTPException(status_code=404, detail="Workflow webhook owner not found.")
    workspace = Workspace(
        id=str(workspace_row["id"]),
        tenant_id=str(workspace_row["tenant_id"]),
        name=str(workspace_row["name"]),
        slug=str(workspace_row["slug"]),
        kind=str(workspace_row["kind"]),
        plan="local",
        region="local",
    )
    profile = AgentProfile(
        id=str(runtime_agent_row["id"]),
        tenant_id=str(runtime_agent_row["tenant_id"]),
        workspace_id=str(runtime_agent_row["workspace_id"]),
        name=str(runtime_agent_row["name"]),
        role=str(runtime_agent_row["role"]),
        status=str(runtime_agent_row["status"]),
        description=str(runtime_agent_row["description"]),
        capabilities=[],
        starters=[],
    )
    return await run_agent(
        workspace,
        profile,
        str(row["workflow_agent_id"]),
        WorkflowRunCreateRequest(input={"event": row["event_name"], "payload": payload}),
        trigger_id=trigger_id,
        trigger_type="webhook",
    )


async def run_trigger(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    trigger_id: str,
    payload: dict[str, Any],
) -> WorkflowRunRecord:
    trigger = get_trigger(workspace, profile, agent_id, trigger_id)
    if not trigger.enabled:
        raise HTTPException(status_code=409, detail="Workflow trigger is disabled.")
    return await run_agent(
        workspace,
        profile,
        agent_id,
        WorkflowRunCreateRequest(input={"event": trigger.event_name, "payload": payload}),
        trigger_id=trigger.id,
        trigger_type=trigger.trigger_type,
    )


async def run_matching_triggers(
    workspace: Workspace,
    profile: AgentProfile,
    trigger_type: str,
    event_name: str,
    payload: dict[str, Any],
) -> WorkflowTriggerRunsResponse:
    rows = db.fetch_all(
        """
        SELECT t.*
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE t.workspace_id = ?
            AND a.runtime_agent_id = ?
            AND t.trigger_type = ?
            AND t.enabled = 1
            AND (? = '' OR t.event_name = ?)
        ORDER BY t.updated_at ASC
        """,
        (workspace.id, profile.id, trigger_type, event_name.strip(), event_name.strip()),
    )
    runs: list[WorkflowRunRecord] = []
    for row in rows:
        runs.append(
            await run_agent(
                workspace,
                profile,
                str(row["workflow_agent_id"]),
                WorkflowRunCreateRequest(input={"event": row["event_name"], "payload": payload}),
                trigger_id=str(row["id"]),
                trigger_type=trigger_type,
            )
        )
    return WorkflowTriggerRunsResponse(runs=runs)


async def tick_due_schedule_triggers(workspace: Workspace, profile: AgentProfile) -> WorkflowTriggerRunsResponse:
    now = datetime.now(timezone.utc)
    rows = db.fetch_all(
        """
        SELECT t.*
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE t.workspace_id = ?
            AND a.runtime_agent_id = ?
            AND t.trigger_type = 'schedule'
            AND t.enabled = 1
        ORDER BY t.updated_at ASC
        """,
        (workspace.id, profile.id),
    )
    runs: list[WorkflowRunRecord] = []
    for row in rows:
        config = _json_loads(row.get("config_json"), {})
        interval_seconds = int(config.get("intervalSeconds") or config.get("interval_seconds") or 0)
        if interval_seconds <= 0:
            minutes = int(config.get("everyMinutes") or config.get("every_minutes") or 0)
            interval_seconds = minutes * 60
        if interval_seconds <= 0:
            continue
        last_run = _parse_iso(str(config.get("lastRunAt") or ""))
        if last_run and (now - last_run).total_seconds() < interval_seconds:
            continue
        config["lastRunAt"] = now_iso()
        db.execute("UPDATE workflow_triggers SET config_json = ?, updated_at = ? WHERE id = ?", (_json_dumps(config), now_iso(), row["id"]))
        runs.append(
            await run_agent(
                workspace,
                profile,
                str(row["workflow_agent_id"]),
                WorkflowRunCreateRequest(
                    input={
                        "event": row["event_name"],
                        "payload": {"scheduledAt": config["lastRunAt"], "config": config},
                    }
                ),
                trigger_id=str(row["id"]),
                trigger_type="schedule",
            )
        )
    return WorkflowTriggerRunsResponse(runs=runs)
