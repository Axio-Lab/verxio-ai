from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import AgentProfile, PulseFlowDefinition, PulseFlowNode, Workspace, new_id
from app.pulse import (
    _automation_from_row,
    _json_dumps,
    add_contact_tag,
    add_message,
    upsert_inbound_message,
)
from app.pulse_channels.outbound import send_channel_message
from app.runtime_dashboard import run_agent_via_dashboard


def _enabled_automation_rows(workspace: Workspace, profile: AgentProfile, channel_type: str) -> list[dict[str, Any]]:
    return db.fetch_all(
        """
        SELECT * FROM pulse_automations
        WHERE workspace_id = ? AND agent_id = ? AND channel_type = ? AND enabled = 1
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id, channel_type),
    )


def _node_by_id(flow: PulseFlowDefinition, node_id: str) -> PulseFlowNode | None:
    return next((node for node in flow.nodes if node.id == node_id), None)


def _next_node(flow: PulseFlowDefinition, current_id: str, branch: str | None = None) -> PulseFlowNode | None:
    for edge in flow.edges:
        if edge.source != current_id:
            continue
        if branch and edge.condition and edge.condition != branch:
            continue
        target = _node_by_id(flow, edge.target)
        if target:
            return target
    return None


def _trigger_matches(trigger: PulseFlowNode, inbound: dict[str, str]) -> bool:
    config = trigger.config
    trigger_kind = str(config.get("trigger") or "new_dm")
    body = inbound.get("body", "").lower()
    if trigger_kind in {"new_dm", "story_reply"}:
        return True
    if trigger_kind in {"comment_keyword", "dm_keyword"}:
        keywords = [str(item).lower() for item in config.get("keywords", []) if str(item).strip()]
        return not keywords or any(keyword in body for keyword in keywords)
    return False


def _first_matching_trigger(flow: PulseFlowDefinition, inbound: dict[str, str]) -> PulseFlowNode | None:
    for node in flow.nodes:
        if node.kind == "trigger" and _trigger_matches(node, inbound):
            return node
    return None


def _create_run(
    workspace: Workspace,
    profile: AgentProfile,
    automation_id: str,
    conversation_id: str,
    context: dict[str, Any],
) -> str:
    created_at = now_iso()
    run_id = new_id("pulse_run")
    db.execute(
        """
        INSERT INTO pulse_runs (
            id, tenant_id, workspace_id, agent_id, automation_id, conversation_id,
            status, context_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?, ?)
        """,
        (
            run_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            automation_id,
            conversation_id,
            _json_dumps(context),
            created_at,
            created_at,
        ),
    )
    return run_id


def _parse_ai_json(output: str) -> dict[str, Any] | None:
    text = output.strip()
    if text.startswith("```"):
        text = text.strip("`")
        if text.lower().startswith("json"):
            text = text[4:].strip()
    start = text.find("{")
    end = text.rfind("}")
    if start >= 0 and end > start:
        text = text[start : end + 1]
    try:
        parsed = json.loads(text)
    except ValueError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _update_run(run_id: str, status: str, context: dict[str, Any], *, cursor_node_id: str | None = None, error: str | None = None) -> None:
    db.execute(
        """
        UPDATE pulse_runs
        SET status = ?, cursor_node_id = ?, context_json = ?, error = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, cursor_node_id, _json_dumps(context), error, now_iso(), run_id),
    )


async def _generate_ai_reply(
    workspace: Workspace,
    profile: AgentProfile,
    node: PulseFlowNode,
    context: dict[str, Any],
) -> dict[str, Any]:
    prompt = {
        "task": "Pulse DM automation AI node",
        "goal": node.config.get("goal") or "Reply helpfully and concisely.",
        "channel": context.get("channel_type"),
        "contact": context.get("contact"),
        "latest_message": context.get("latest_message"),
        "constraints": {
            "format": "Return only JSON with reply, tags, fields, next_branch, handoff, actions.",
            "policy": "Respect the channel reply window and avoid unsupported automation.",
        },
        "composio": "You may use connected mcp_composio_* tools for CRM, sheets, email, or task actions if relevant.",
    }
    instructions = (
        "You are the Verxio Pulse chat marketing agent. Return valid JSON only: "
        "{\"reply\":\"...\",\"tags\":[],\"fields\":{},\"next_branch\":null,\"handoff\":false,\"actions\":[]}."
    )
    try:
        output = await run_agent_via_dashboard(workspace, profile, json.dumps(prompt), instructions=instructions)
        parsed = _parse_ai_json(output)
        if parsed:
            return parsed
    except Exception:
        pass
    return {
        "reply": "Thanks for reaching out. I can help with that. What would you like to know next?",
        "tags": ["pulse-ai-fallback"],
        "fields": {},
        "next_branch": None,
        "handoff": False,
        "actions": [],
    }


async def _send_and_record(
    workspace: Workspace,
    profile: AgentProfile,
    channel_row: dict[str, Any],
    conversation_id: str,
    recipient_id: str,
    body: str,
    *,
    comment_id: str | None = None,
) -> None:
    conversation_row = db.fetch_one(
        "SELECT window_expires_at FROM pulse_conversations WHERE id = ?",
        (conversation_id,),
    )
    if channel_row.get("channel_type") in {"instagram", "messenger", "whatsapp"} and not comment_id:
        window_expires_at = str((conversation_row or {}).get("window_expires_at") or "")
        if window_expires_at:
            try:
                expires_at = datetime.fromisoformat(window_expires_at)
                if expires_at.tzinfo is None:
                    expires_at = expires_at.replace(tzinfo=timezone.utc)
                if expires_at < datetime.now(timezone.utc):
                    raise HTTPException(status_code=409, detail="The channel reply window has expired.")
            except ValueError:
                pass
    message = add_message(workspace, profile, conversation_id, "outbound", body, status="queued")
    try:
        provider_id = await send_channel_message(channel_row, recipient_id, body, comment_id=comment_id)
        db.execute(
            """
            UPDATE pulse_messages
            SET status = 'sent', provider_message_id = ?, updated_at = ?
            WHERE id = ?
            """,
            (provider_id, now_iso(), message.id),
        )
    except Exception as exc:
        db.execute(
            """
            UPDATE pulse_messages
            SET status = 'failed', updated_at = ?
            WHERE id = ?
            """,
            (now_iso(), message.id),
        )
        raise exc


async def _execute_flow(
    workspace: Workspace,
    profile: AgentProfile,
    channel_row: dict[str, Any],
    automation_id: str,
    flow: PulseFlowDefinition,
    trigger: PulseFlowNode,
    conversation_id: str,
    contact_id: str,
    inbound: dict[str, str],
) -> None:
    context: dict[str, Any] = {
        "channel_type": channel_row["channel_type"],
        "contact": {
            "id": contact_id,
            "external_user_id": inbound.get("external_user_id"),
            "display_name": inbound.get("display_name") or inbound.get("username"),
        },
        "latest_message": inbound.get("body"),
        "tags": [],
        "fields": {},
    }
    run_id = _create_run(workspace, profile, automation_id, conversation_id, context)
    current = _next_node(flow, trigger.id)
    try:
        while current:
            _update_run(run_id, "running", context, cursor_node_id=current.id)
            if current.kind in {"send_message", "ask_question"}:
                body = str(current.config.get("body") or current.config.get("message") or "").strip()
                if body:
                    await _send_and_record(
                        workspace,
                        profile,
                        channel_row,
                        conversation_id,
                        inbound.get("external_user_id") or "unknown",
                        body,
                        comment_id=inbound.get("provider_message_id") or None,
                    )
                current = _next_node(flow, current.id)
                continue
            if current.kind == "ai_reply":
                result = await _generate_ai_reply(workspace, profile, current, context)
                context["fields"].update(result.get("fields") if isinstance(result.get("fields"), dict) else {})
                for tag in result.get("tags", []) if isinstance(result.get("tags"), list) else []:
                    tag_name = str(tag).strip()
                    if tag_name:
                        add_contact_tag(workspace, profile, contact_id, tag_name)
                        context["tags"].append(tag_name)
                reply = str(result.get("reply") or "").strip()
                if reply:
                    await _send_and_record(
                        workspace,
                        profile,
                        channel_row,
                        conversation_id,
                        inbound.get("external_user_id") or "unknown",
                        reply,
                        comment_id=inbound.get("provider_message_id") or None,
                    )
                if result.get("handoff"):
                    db.execute(
                        "UPDATE pulse_conversations SET state = 'human', updated_at = ? WHERE id = ?",
                        (now_iso(), conversation_id),
                    )
                    _update_run(run_id, "handoff", context, cursor_node_id=current.id)
                    return
                current = _next_node(flow, current.id, branch=result.get("next_branch"))
                continue
            if current.kind == "set_tag":
                tag_name = str(current.config.get("tag") or "").strip()
                if tag_name:
                    add_contact_tag(workspace, profile, contact_id, tag_name)
                    context["tags"].append(tag_name)
                current = _next_node(flow, current.id)
                continue
            if current.kind == "set_field":
                field = str(current.config.get("field") or "").strip()
                if field:
                    context["fields"][field] = current.config.get("value")
                current = _next_node(flow, current.id)
                continue
            if current.kind == "composio_action":
                await _generate_ai_reply(
                    workspace,
                    profile,
                    PulseFlowNode(
                        id=current.id,
                        kind="ai_reply",
                        label=current.label,
                        config={
                            "goal": "Run the requested Composio-connected action if the required app is connected. "
                            + json.dumps(current.config)
                        },
                    ),
                    context,
                )
                current = _next_node(flow, current.id)
                continue
            if current.kind == "wait":
                _update_run(run_id, "waiting", context, cursor_node_id=current.id)
                return
            if current.kind == "condition":
                branch = str(current.config.get("branch") or "yes")
                current = _next_node(flow, current.id, branch=branch) or _next_node(flow, current.id)
                continue
            if current.kind == "handoff":
                db.execute(
                    "UPDATE pulse_conversations SET state = 'human', updated_at = ? WHERE id = ?",
                    (now_iso(), conversation_id),
                )
                _update_run(run_id, "handoff", context, cursor_node_id=current.id)
                return
            if current.kind == "end":
                _update_run(run_id, "completed", context, cursor_node_id=current.id)
                return
            current = _next_node(flow, current.id)
        _update_run(run_id, "completed", context)
    except Exception as exc:
        _update_run(run_id, "failed", context, cursor_node_id=current.id if current else None, error=str(exc))


async def process_inbound_message(channel_row: dict[str, Any], inbound: dict[str, str]) -> None:
    workspace, profile, conversation, _message = upsert_inbound_message(
        channel_row,
        external_user_id=inbound.get("external_user_id") or "unknown",
        body=inbound.get("body") or "",
        provider_message_id=inbound.get("provider_message_id") or None,
        username=inbound.get("username") or None,
        display_name=inbound.get("display_name") or None,
    )
    conversation_detail = db.fetch_one(
        "SELECT contact_id FROM pulse_conversations WHERE id = ?",
        (conversation.id,),
    )
    if not conversation_detail:
        return
    for row in _enabled_automation_rows(workspace, profile, str(channel_row["channel_type"])):
        automation = _automation_from_row(row)
        trigger = _first_matching_trigger(automation.flow, inbound)
        if not trigger:
            continue
        await _execute_flow(
            workspace,
            profile,
            channel_row,
            automation.id,
            automation.flow,
            trigger,
            conversation.id,
            str(conversation_detail["contact_id"]),
            inbound,
        )
        return


def tick_due_runs() -> dict[str, int]:
    now = now_iso()
    rows = db.fetch_all(
        """
        SELECT id FROM pulse_runs
        WHERE status = 'waiting' AND wait_until IS NOT NULL AND wait_until <= ?
        """,
        (now,),
    )
    for row in rows:
        db.execute(
            """
            UPDATE pulse_runs
            SET status = 'queued', updated_at = ?
            WHERE id = ?
            """,
            (now, row["id"]),
        )
    return {"resumed": len(rows)}
