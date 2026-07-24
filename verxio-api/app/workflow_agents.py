from __future__ import annotations

import json
import secrets
from typing import Any

from fastapi import HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    WorkflowAgentCreateRequest,
    WorkflowAgentRecord,
    WorkflowAgentsResponse,
    WorkflowAgentUpdateRequest,
    WorkflowRunCreateRequest,
    WorkflowRunRecord,
    WorkflowRunsResponse,
    WorkflowTriggerCreateRequest,
    WorkflowTriggerRecord,
    WorkflowTriggersResponse,
    WorkflowTriggerUpdateRequest,
    Workspace,
    new_id,
)
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
    return _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run_id,)) or {})


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


def _build_instructions(agent: WorkflowAgentRecord) -> str:
    parts = [
        f"You are the Verxio workflow agent named {agent.name}.",
        f"Role: {agent.role or 'Complete the assigned workflow run.'}",
        agent.instructions or "Complete the task using the provided event/input payload.",
        "Respect the per-agent setup below.",
        f"Skills enabled: {', '.join(agent.skills) or 'none'}",
        f"Knowledge sources enabled: {', '.join(agent.knowledge) or 'none'}",
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
    try:
        output = await run_agent_via_dashboard(
            workspace,
            profile,
            _json_dumps({"trigger_type": trigger_type, "trigger_id": trigger_id, "input": payload.input}),
            instructions=_build_instructions(agent),
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
