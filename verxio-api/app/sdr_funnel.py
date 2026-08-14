"""SDR keyword funnel, contacts, and durable follow-ups."""

from __future__ import annotations

import json
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    SdrContactRecord,
    SdrContactsExportResponse,
    SdrContactsResponse,
    WorkflowAgentRecord,
    Workspace,
    new_id,
)
from app.runtime_dashboard import run_agent_via_dashboard, send_message_via_dashboard

CLOSING_PHRASES = (
    "no",
    "nope",
    "nothing else",
    "that's all",
    "thats all",
    "i'm good",
    "im good",
    "i am good",
    "no thank you",
    "no thanks",
    "nothing more",
    "no more questions",
)


def _json_loads(value: Any, fallback: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = str(item or "").strip()
        if text and text not in seen:
            seen.add(text)
            out.append(text)
    return out


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().lower()


def is_closing_message(message: str) -> bool:
    lower = message.strip().lower()
    if not lower:
        return False
    return any(lower == phrase or phrase in lower for phrase in CLOSING_PHRASES)


def render_template(template: str, variables: dict[str, str]) -> str:
    return re.sub(r"\{\{\s*(\w+)\s*\}\}", lambda match: variables.get(match.group(1), ""), template)


def build_template_vars(answers: list[str], extra: dict[str, str] | None = None) -> dict[str, str]:
    variables = {f"answer{index + 1}": answer for index, answer in enumerate(answers)}
    if extra:
        variables.update(extra)
    return variables


def keyword_matched(message: str, triggers: list[str]) -> bool:
    incoming = normalize_text(message)
    return any(bool((key := normalize_text(trigger))) and (incoming == key or key in incoming) for trigger in triggers)


def to_deterministic_rules(funnel_rules: Any) -> list[dict[str, Any]]:
    if not funnel_rules:
        return []
    if isinstance(funnel_rules, list):
        source = funnel_rules
    elif isinstance(funnel_rules, dict):
        source = funnel_rules.get("rules") if isinstance(funnel_rules.get("rules"), list) else []
    else:
        return []

    rules: list[dict[str, Any]] = []
    for index, item in enumerate(source):
        if not isinstance(item, dict):
            continue
        questions = _string_list(item.get("questions"))
        if not questions:
            legacy = [str(item.get("question1") or "").strip(), str(item.get("question2") or "").strip()]
            questions = [question for question in legacy if question]
        branches: list[dict[str, Any]] = []
        for branch in item.get("branches") or []:
            if not isinstance(branch, dict):
                continue
            keywords = _string_list(branch.get("matchKeywords") or branch.get("match_keywords"))
            if not keywords:
                continue
            branches.append(
                {
                    "matchKeywords": keywords,
                    "summary": str(branch.get("summary") or "").strip(),
                    "assetUrl": str(branch.get("assetUrl") or branch.get("asset_url") or "").strip(),
                    "assetLabel": str(branch.get("assetLabel") or branch.get("asset_label") or "").strip(),
                }
            )
        follow_ups: list[dict[str, Any]] = []
        raw_follow_ups = item.get("followUps") or item.get("follow_ups") or []
        if isinstance(raw_follow_ups, list):
            for follow_up in raw_follow_ups:
                if not isinstance(follow_up, dict):
                    continue
                message = str(follow_up.get("message") or "").strip()
                if not message:
                    continue
                delay = follow_up.get("delayMinutes") if follow_up.get("delayMinutes") is not None else follow_up.get("delay_minutes")
                try:
                    delay_minutes = max(1, int(delay or 30))
                except (TypeError, ValueError):
                    delay_minutes = 30
                follow_ups.append(
                    {
                        "message": message,
                        "useCustomMessage": bool(follow_up.get("useCustomMessage") or follow_up.get("use_custom_message")),
                        "delayMinutes": delay_minutes,
                        "sendAt": str(follow_up.get("sendAt") or follow_up.get("send_at") or "").strip(),
                        "ctaUrl": str(follow_up.get("ctaUrl") or follow_up.get("cta_url") or "").strip(),
                    }
                )
        if not follow_ups:
            legacy_message = str(item.get("followUpMessage") or "").strip()
            if legacy_message:
                try:
                    legacy_delay = max(1, int(item.get("followUpDelayMinutes") or 30))
                except (TypeError, ValueError):
                    legacy_delay = 30
                follow_ups.append(
                    {
                        "message": legacy_message,
                        "useCustomMessage": False,
                        "delayMinutes": legacy_delay,
                        "sendAt": "",
                        "ctaUrl": "",
                    }
                )
        try:
            max_replies = int(item.get("maxAgentReplies") or item.get("max_agent_replies") or 3)
        except (TypeError, ValueError):
            max_replies = 3
        rule = {
            "key": str(item.get("id") or item.get("key") or "").strip() or f"rule-{index + 1}",
            "triggers": _string_list(item.get("triggers")),
            "questionsEnabled": item.get("questionsEnabled") is True or bool(questions),
            "questions": questions,
            "summary": str(item.get("summary") or "").strip(),
            "assetUrl": str(item.get("assetUrl") or item.get("asset_url") or "").strip(),
            "assetLabel": str(item.get("assetLabel") or item.get("asset_label") or "").strip(),
            "maxAgentReplies": max(1, max_replies),
            "branches": branches,
            "followUpEnabled": item.get("followUpEnabled") is True or item.get("follow_up_enabled") is True,
            "followUps": follow_ups,
        }
        if rule["triggers"] and (rule["summary"] or rule["assetUrl"] or any(branch.get("assetUrl") or branch.get("summary") for branch in branches)):
            rules.append(rule)
    return rules


def normalize_flow_state(raw: Any) -> dict[str, Any]:
    empty = {
        "activeRuleKey": None,
        "step": "idle",
        "completedRuleKeys": [],
        "answers": [],
        "currentQuestionIndex": 0,
        "repliesSent": 0,
        "followUpVersion": 0,
        "followUpSentCount": 0,
        "followUpNextFireAt": None,
        "sessionType": "web",
        "matchedBranchIndex": None,
        "updatedAt": now_iso(),
    }
    if not isinstance(raw, dict):
        return empty
    step = "idle"
    current_question_index = 0
    if raw.get("step") == "questioning":
        step = "questioning"
        try:
            current_question_index = max(0, int(raw.get("currentQuestionIndex") or 0))
        except (TypeError, ValueError):
            current_question_index = 0
    elif raw.get("step") == "q1_asked":
        step = "questioning"
        current_question_index = 0
    elif raw.get("step") == "q2_asked":
        step = "questioning"
        current_question_index = 1
    elif raw.get("step") == "completed":
        step = "completed"
    answers = raw.get("answers")
    if not isinstance(answers, list):
        answers = [item for item in (raw.get("answer1"), raw.get("answer2")) if isinstance(item, str)]
    else:
        answers = [str(item) if item is not None else "" for item in answers]
    completed = [str(item).strip() for item in (raw.get("completedRuleKeys") or []) if str(item).strip()]

    def _int(key: str, default: int = 0) -> int:
        try:
            return max(0, int(raw.get(key) if raw.get(key) is not None else default))
        except (TypeError, ValueError):
            return default

    matched = raw.get("matchedBranchIndex")
    try:
        matched_index = int(matched) if matched is not None else None
    except (TypeError, ValueError):
        matched_index = None
    return {
        "activeRuleKey": str(raw.get("activeRuleKey") or "").strip() or None,
        "step": step,
        "completedRuleKeys": completed,
        "answers": answers,
        "currentQuestionIndex": current_question_index,
        "repliesSent": _int("repliesSent"),
        "followUpVersion": _int("followUpVersion"),
        "followUpSentCount": _int("followUpSentCount"),
        "followUpNextFireAt": str(raw.get("followUpNextFireAt") or "").strip() or None,
        "sessionType": "channel" if raw.get("sessionType") == "channel" else "web",
        "matchedBranchIndex": matched_index,
        "updatedAt": str(raw.get("updatedAt") or now_iso()),
    }


def resolve_branch_cta(rule: dict[str, Any], branch_index: int | None) -> dict[str, str]:
    branches = rule.get("branches") or []
    if branch_index is not None and 0 <= branch_index < len(branches):
        branch = branches[branch_index]
        return {
            "summary": str(branch.get("summary") or rule.get("summary") or ""),
            "assetUrl": str(branch.get("assetUrl") or rule.get("assetUrl") or ""),
            "assetLabel": str(branch.get("assetLabel") or rule.get("assetLabel") or ""),
        }
    return {
        "summary": str(rule.get("summary") or ""),
        "assetUrl": str(rule.get("assetUrl") or ""),
        "assetLabel": str(rule.get("assetLabel") or ""),
    }


def compute_follow_up_fire_at(follow_up: dict[str, Any], *, now: datetime | None = None) -> datetime:
    now = now or datetime.now(timezone.utc)
    send_at = str(follow_up.get("sendAt") or "").strip()
    if send_at:
        try:
            target = datetime.fromisoformat(send_at.replace("Z", "+00:00"))
            if target.tzinfo is None:
                target = target.replace(tzinfo=timezone.utc)
            delay = min(max(1.0, (target - now).total_seconds()), 7 * 24 * 60 * 60)
            return now + timedelta(seconds=delay)
        except ValueError:
            pass
    try:
        delay_minutes = max(1, int(follow_up.get("delayMinutes") or 30))
    except (TypeError, ValueError):
        delay_minutes = 30
    seconds = min(delay_minutes * 60, 7 * 24 * 60 * 60)
    return now + timedelta(seconds=seconds)


def build_follow_up_text(follow_up: dict[str, Any]) -> str:
    message = str(follow_up.get("message") or "").strip()
    cta = str(follow_up.get("ctaUrl") or "").strip()
    return f"{message}\n\nView details: {cta}" if cta else message


def match_branch_index_literal(answer: str, branches: list[dict[str, Any]]) -> int:
    normalized = normalize_text(answer)
    for index, branch in enumerate(branches):
        for keyword in branch.get("matchKeywords") or []:
            key = normalize_text(str(keyword))
            if key and (normalized == key or key in normalized):
                return index
    return -1


async def _llm_text(workspace: Workspace, profile: AgentProfile, system: str, user: str) -> str:
    try:
        text = await run_agent_via_dashboard(workspace, profile, user, instructions=system)
    except Exception:
        return ""
    return str(text or "").strip()


async def agentize_response(
    workspace: Workspace,
    profile: AgentProfile,
    *,
    directive: str,
    agent_name: str,
    campaign_context: str,
    answers: list[str] | None = None,
    questions: list[str] | None = None,
    current_question: str = "",
    asset_url: str = "",
    asset_label: str = "",
    kind: str = "question",
) -> str:
    answers = answers or []
    questions = questions or []
    parts = [
        f'You are "{agent_name or "a senior sales rep"}". You have years of experience closing deals and talking to prospects.',
        "You write like a real person messaging a prospect, not like a chatbot or AI assistant.",
        "STRICT TONE RULES:",
        "- Be DIRECT. Get to the point immediately. No preambles, no buildup.",
        "- No emojis. No em dashes. No bullet points. No numbered lists.",
        '- NEVER start with "Got it", "Great", "Interesting", "That makes sense", "Here\'s what", "I see", "Understood".',
        "- Short, punchy sentences. Maximum 3-4 sentences total.",
        "- Do not mention being an AI, model, or assistant.",
    ]
    if kind == "question":
        parts.extend(
            [
                "YOUR TASK: Ask a follow-up question.",
                "- Jump straight into the question. One question only.",
                "- The question must end with a question mark.",
            ]
        )
    elif kind == "cta":
        parts.extend(
            [
                "YOUR TASK: Deliver a resource/link.",
                "- 1-2 sentences connecting their situation to why this resource fits.",
                "- Then on a NEW LINE, write a short label followed by the link.",
            ]
        )
        if asset_url:
            parts.append(f"- You MUST include this EXACT link on its own line: {asset_url}")
        if asset_label:
            parts.append(f"- Resource name: {asset_label}")
    elif kind == "derail":
        parts.extend(
            [
                "YOUR TASK: Redirect back to the question.",
                "- If they asked something valid, give a one-line answer, then steer back.",
                "- Keep it to 2 lines max.",
            ]
        )
        if current_question:
            parts.append(f'- Re-ask this: "{current_question}"')
    else:
        parts.extend(
            [
                "YOUR TASK: Send a follow-up nudge.",
                "- Short and casual. Like checking back in.",
                "- 2 sentences max. Each on its own line.",
            ]
        )
    context = [f"Directive/template: {directive}"]
    for index, answer in enumerate(answers):
        if answer:
            context.append(f'User\'s answer to question {index + 1}: "{answer}"')
    for index, question in enumerate(questions):
        if question:
            context.append(f'Question {index + 1} was: "{question}"')
    if campaign_context:
        context.append(f"Campaign context:\n{campaign_context}")
    result = await _llm_text(workspace, profile, "\n".join(parts), "\n".join(context))
    return result or directive.strip()


async def is_relevant_answer(
    workspace: Workspace,
    profile: AgentProfile,
    message: str,
    current_question: str,
) -> bool:
    if not current_question.strip():
        return True
    system = (
        "You are a relevance classifier for a sales conversation. "
        "Decide if the user's message is a reasonable attempt to answer the question. "
        "Be generous. Output ONLY: true or false."
    )
    user = f'Current question asked: "{current_question}"\nUser\'s message: "{message}"\nIs this a relevant answer? Reply true or false.'
    text = (await _llm_text(workspace, profile, system, user)).lower()
    if not text:
        return True
    return "false" not in text.split()[0]


def _contact_from_row(row: dict[str, Any]) -> SdrContactRecord:
    payload = dict(row)
    payload["metadata"] = _json_loads(payload.pop("metadata_json", "{}"), {})
    return SdrContactRecord(**payload)


def upsert_sdr_contact(
    workspace: Workspace,
    agent_id: str,
    *,
    channel: str,
    sender_id: str,
    sender_name: str = "",
    conversation_id: str = "",
    connection_id: str = "",
    metadata: dict[str, Any] | None = None,
) -> None:
    sender_id = sender_id.strip()
    channel = channel.strip().lower()
    if not sender_id or not channel:
        return
    now = now_iso()
    existing = db.fetch_one(
        """
        SELECT id FROM sdr_contacts
        WHERE workflow_agent_id = ? AND channel = ? AND sender_id = ?
        """,
        (agent_id, channel, sender_id),
    )
    if existing:
        db.execute(
            """
            UPDATE sdr_contacts
            SET sender_name = CASE WHEN ? != '' THEN ? ELSE sender_name END,
                conversation_id = CASE WHEN ? != '' THEN ? ELSE conversation_id END,
                connection_id = CASE WHEN ? != '' THEN ? ELSE connection_id END,
                metadata_json = ?, updated_at = ?
            WHERE id = ?
            """,
            (
                sender_name.strip(),
                sender_name.strip(),
                conversation_id.strip(),
                conversation_id.strip(),
                connection_id.strip(),
                connection_id.strip(),
                _json_dumps(metadata or {}),
                now,
                existing["id"],
            ),
        )
        return
    db.execute(
        """
        INSERT INTO sdr_contacts (
            id, tenant_id, workspace_id, workflow_agent_id, channel, sender_id, sender_name,
            conversation_id, connection_id, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("sdr_contact"),
            workspace.tenant_id,
            workspace.id,
            agent_id,
            channel,
            sender_id,
            sender_name.strip(),
            conversation_id.strip(),
            connection_id.strip(),
            _json_dumps(metadata or {}),
            now,
            now,
        ),
    )


def list_sdr_contacts(workspace: Workspace, agent_id: str, channel: str = "") -> SdrContactsResponse:
    params: list[Any] = [workspace.id, agent_id]
    where = "workspace_id = ? AND workflow_agent_id = ?"
    if channel.strip():
        where += " AND channel = ?"
        params.append(channel.strip().lower())
    rows = db.fetch_all(
        f"""
        SELECT * FROM sdr_contacts
        WHERE {where}
        ORDER BY updated_at DESC
        """,
        params,
    )
    contacts = [_contact_from_row(row) for row in rows]
    return SdrContactsResponse(contacts=contacts, total=len(contacts))


def _escape_vcf(value: str) -> str:
    return value.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,").replace("\n", "\\n")


def export_sdr_contacts_vcf(workspace: Workspace, agent: WorkflowAgentRecord, channel: str = "") -> SdrContactsExportResponse:
    contacts = list_sdr_contacts(workspace, agent.id, channel).contacts
    cards: list[str] = []
    for index, contact in enumerate(contacts):
        display = (contact.sender_name or contact.sender_id or f"Contact {index + 1}").strip()
        phone = ""
        if isinstance(contact.metadata, dict):
            phone = str(contact.metadata.get("phone") or "").strip()
        if not phone and contact.channel == "whatsapp":
            phone = contact.sender_id.split("@")[0]
        lines = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            f"FN:{_escape_vcf(display)}",
        ]
        if phone:
            lines.append(f"TEL;TYPE=CELL:{phone}")
        if contact.channel:
            lines.append(f"NOTE:From {contact.channel} SDR")
        lines.append("END:VCARD")
        cards.append("\r\n".join(lines))
    suffix = f"-{channel.strip().lower()}" if channel.strip() else ""
    filename = f"sdr-contacts-{agent.name.replace(' ', '-')}{suffix}-{datetime.now(timezone.utc).date().isoformat()}.vcf"
    return SdrContactsExportResponse(filename=filename, vcf="\r\n".join(cards))


def _get_or_create_session(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    conversation_id: str,
) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT * FROM sdr_sessions
        WHERE workflow_agent_id = ? AND conversation_id = ?
        """,
        (agent_id, conversation_id),
    )
    if row:
        return row
    now = now_iso()
    session_id = new_id("sdr_session")
    db.execute(
        """
        INSERT INTO sdr_sessions (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id, conversation_id,
            session_type, flow_state_json, follow_up_next_fire_at, reply_channel, reply_connection_id,
            reply_conversation_id, reply_sender_id, reply_thread_id, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 'web', '{}', NULL, '', '', '', '', '', ?, ?)
        """,
        (
            session_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            agent_id,
            conversation_id,
            now,
            now,
        ),
    )
    return db.fetch_one("SELECT * FROM sdr_sessions WHERE id = ?", (session_id,)) or {}


def _save_session(
    session_id: str,
    flow_state: dict[str, Any],
    *,
    session_type: str = "web",
    follow_up_next_fire_at: str | None = None,
    reply: dict[str, str] | None = None,
) -> None:
    reply = reply or {}
    db.execute(
        """
        UPDATE sdr_sessions
        SET session_type = ?, flow_state_json = ?, follow_up_next_fire_at = ?,
            reply_channel = CASE WHEN ? != '' THEN ? ELSE reply_channel END,
            reply_connection_id = CASE WHEN ? != '' THEN ? ELSE reply_connection_id END,
            reply_conversation_id = CASE WHEN ? != '' THEN ? ELSE reply_conversation_id END,
            reply_sender_id = CASE WHEN ? != '' THEN ? ELSE reply_sender_id END,
            reply_thread_id = CASE WHEN ? != '' THEN ? ELSE reply_thread_id END,
            updated_at = ?
        WHERE id = ?
        """,
        (
            session_type,
            _json_dumps(flow_state),
            follow_up_next_fire_at,
            reply.get("channel") or "",
            reply.get("channel") or "",
            reply.get("connection_id") or "",
            reply.get("connection_id") or "",
            reply.get("conversation_id") or "",
            reply.get("conversation_id") or "",
            reply.get("sender_id") or "",
            reply.get("sender_id") or "",
            reply.get("thread_id") or "",
            reply.get("thread_id") or "",
            now_iso(),
            session_id,
        ),
    )


def _schedule_follow_up(session_id: str, flow_state: dict[str, Any], rule: dict[str, Any]) -> dict[str, Any]:
    if not rule.get("followUpEnabled") or flow_state.get("sessionType") != "channel":
        flow_state["followUpNextFireAt"] = None
        _save_session(session_id, flow_state, session_type=str(flow_state.get("sessionType") or "web"), follow_up_next_fire_at=None)
        return flow_state
    follow_ups = [item for item in (rule.get("followUps") or []) if str(item.get("message") or "").strip()]
    sent = int(flow_state.get("followUpSentCount") or 0)
    if sent >= len(follow_ups):
        flow_state["followUpNextFireAt"] = None
        _save_session(session_id, flow_state, session_type="channel", follow_up_next_fire_at=None)
        return flow_state
    fire_at = compute_follow_up_fire_at(follow_ups[sent]).isoformat()
    flow_state["followUpNextFireAt"] = fire_at
    flow_state["updatedAt"] = now_iso()
    _save_session(session_id, flow_state, session_type="channel", follow_up_next_fire_at=fire_at)
    return flow_state


def _reply_from_input(run_input: dict[str, Any]) -> dict[str, str]:
    payload = run_input.get("payload") if isinstance(run_input.get("payload"), dict) else run_input
    if not isinstance(payload, dict):
        payload = {}
    reply = payload.get("reply_to_source") if isinstance(payload.get("reply_to_source"), dict) else {}
    return {
        "channel": str(reply.get("channel") or payload.get("channel") or "").strip(),
        "connection_id": str(reply.get("connection_id") or payload.get("connection_id") or "").strip(),
        "conversation_id": str(reply.get("conversation_id") or payload.get("conversation_id") or "").strip(),
        "sender_id": str(reply.get("sender_id") or payload.get("sender_id") or "").strip(),
        "thread_id": str(reply.get("thread_id") or payload.get("thread_id") or "").strip(),
        "sender_name": str(payload.get("sender_name") or "").strip(),
    }


async def maybe_handle_sdr_message(
    workspace: Workspace,
    profile: AgentProfile,
    agent: WorkflowAgentRecord,
    *,
    message: str,
    conversation_id: str,
    trigger_type: str,
    run_input: dict[str, Any],
) -> str | None:
    if not conversation_id:
        return None
    rules = to_deterministic_rules(agent.funnel_rules)
    session_type = "channel" if trigger_type == "chat" else "web"
    reply = _reply_from_input(run_input)
    if session_type == "channel":
        upsert_sdr_contact(
            workspace,
            agent.id,
            channel=reply.get("channel") or "",
            sender_id=reply.get("sender_id") or conversation_id,
            sender_name=reply.get("sender_name") or "",
            conversation_id=reply.get("conversation_id") or conversation_id,
            connection_id=reply.get("connection_id") or "",
            metadata={"thread_id": reply.get("thread_id") or ""},
        )
    if not rules:
        return None

    session = _get_or_create_session(workspace, profile, agent.id, conversation_id)
    flow_state = normalize_flow_state(_json_loads(session.get("flow_state_json"), {}))
    flow_state["followUpVersion"] = int(flow_state.get("followUpVersion") or 0) + 1
    flow_state["followUpNextFireAt"] = None
    flow_state["sessionType"] = session_type
    flow_state["updatedAt"] = now_iso()
    _save_session(str(session["id"]), flow_state, session_type=session_type, follow_up_next_fire_at=None, reply=reply)

    async def persist(state: dict[str, Any], rule: dict[str, Any] | None = None) -> dict[str, Any]:
        state["updatedAt"] = now_iso()
        if rule is not None:
            return _schedule_follow_up(str(session["id"]), state, rule)
        _save_session(str(session["id"]), state, session_type=session_type, follow_up_next_fire_at=state.get("followUpNextFireAt"), reply=reply)
        return state

    campaign = agent.campaign_context.strip()
    active_rule = next((rule for rule in rules if rule["key"] == flow_state.get("activeRuleKey") and flow_state.get("step") != "idle"), None)

    if active_rule and flow_state.get("step") != "completed":
        cap = int(active_rule.get("maxAgentReplies") or 3)
        if int(flow_state.get("repliesSent") or 0) >= cap:
            flow_state["step"] = "completed"
            flow_state["completedRuleKeys"] = list(dict.fromkeys([*(flow_state.get("completedRuleKeys") or []), active_rule["key"]]))
            flow_state = await persist(flow_state, active_rule)
        elif flow_state.get("step") == "questioning":
            question_index = int(flow_state.get("currentQuestionIndex") or 0)
            questions = active_rule.get("questions") or []
            current_question = render_template(questions[question_index] if question_index < len(questions) else "", build_template_vars(flow_state.get("answers") or []))
            relevant = await is_relevant_answer(workspace, profile, message, current_question)
            if not relevant:
                reply_text = await agentize_response(
                    workspace,
                    profile,
                    directive=current_question,
                    agent_name=agent.name,
                    campaign_context=campaign,
                    answers=flow_state.get("answers") or [],
                    questions=questions,
                    current_question=current_question,
                    kind="derail",
                )
                flow_state["repliesSent"] = int(flow_state.get("repliesSent") or 0) + 1
                await persist(flow_state, active_rule)
                return reply_text.strip()
            answers = list(flow_state.get("answers") or [])
            while len(answers) <= question_index:
                answers.append("")
            answers[question_index] = message.strip()
            next_index = question_index + 1
            if next_index < len(questions) and str(questions[next_index] or "").strip():
                next_question = render_template(questions[next_index], build_template_vars(answers))
                reply_text = await agentize_response(
                    workspace,
                    profile,
                    directive=next_question,
                    agent_name=agent.name,
                    campaign_context=campaign,
                    answers=answers,
                    questions=questions,
                    kind="question",
                )
                flow_state.update(
                    {
                        "answers": answers,
                        "currentQuestionIndex": next_index,
                        "repliesSent": int(flow_state.get("repliesSent") or 0) + 1,
                    }
                )
                await persist(flow_state, active_rule)
                return reply_text.strip()
            branch_index = match_branch_index_literal(answers[question_index], active_rule.get("branches") or [])
            resolved = resolve_branch_cta(active_rule, branch_index if branch_index >= 0 else None)
            cta_directive = render_template(resolved["summary"], build_template_vars(answers, {"question1": questions[0] if questions else "", "question2": questions[1] if len(questions) > 1 else ""}))
            reply_text = await agentize_response(
                workspace,
                profile,
                directive=cta_directive or "Based on everything shared, deliver the most relevant resource.",
                agent_name=agent.name,
                campaign_context=campaign,
                answers=answers,
                questions=questions,
                asset_url=resolved["assetUrl"],
                asset_label=resolved["assetLabel"],
                kind="cta",
            )
            flow_state.update(
                {
                    "answers": answers,
                    "step": "completed",
                    "completedRuleKeys": list(dict.fromkeys([*(flow_state.get("completedRuleKeys") or []), active_rule["key"]])),
                    "matchedBranchIndex": branch_index if branch_index >= 0 else None,
                    "repliesSent": int(flow_state.get("repliesSent") or 0) + 1,
                }
            )
            await persist(flow_state, active_rule)
            return reply_text.strip()

    matched = next((rule for rule in rules if keyword_matched(message, rule["triggers"])), None)
    if matched:
        engaged = (flow_state.get("activeRuleKey") == matched["key"] and flow_state.get("step") != "idle") or matched["key"] in (flow_state.get("completedRuleKeys") or [])
        if not engaged:
            first_question = str((matched.get("questions") or [""])[0] if matched.get("questions") else "").strip()
            if matched.get("questionsEnabled") and first_question:
                flow_state.update(
                    {
                        "activeRuleKey": matched["key"],
                        "step": "questioning",
                        "currentQuestionIndex": 0,
                        "answers": [],
                        "matchedBranchIndex": None,
                        "repliesSent": 1,
                        "followUpSentCount": 0,
                    }
                )
                await persist(flow_state, matched)
                return first_question
            summary = str(matched.get("summary") or "").strip()
            reply_text = await agentize_response(
                workspace,
                profile,
                directive=summary or f"Deliver the {(matched.get('assetLabel') or 'resource').strip()} to the user in a natural way.",
                agent_name=agent.name,
                campaign_context=campaign,
                asset_url=str(matched.get("assetUrl") or ""),
                asset_label=str(matched.get("assetLabel") or ""),
                kind="cta",
            )
            flow_state.update(
                {
                    "activeRuleKey": matched["key"],
                    "step": "completed",
                    "completedRuleKeys": list(dict.fromkeys([*(flow_state.get("completedRuleKeys") or []), matched["key"]])),
                    "answers": [],
                    "currentQuestionIndex": 0,
                    "repliesSent": 1,
                    "followUpSentCount": 0,
                }
            )
            await persist(flow_state, matched)
            return reply_text.strip()

    completed_rule = next((rule for rule in rules if rule["key"] == flow_state.get("activeRuleKey")), None)
    cap_still_active = (
        flow_state.get("step") == "completed"
        and completed_rule is not None
        and int(flow_state.get("repliesSent") or 0) >= int(completed_rule.get("maxAgentReplies") or 3)
    )
    if not cap_still_active and (flow_state.get("step") != "idle" or flow_state.get("activeRuleKey")):
        flow_state.update(
            {
                "activeRuleKey": None,
                "step": "idle",
                "answers": [],
                "currentQuestionIndex": 0,
            }
        )
        await persist(flow_state)
    return None


def _session_owner_context(row: dict[str, Any]) -> tuple[Workspace, AgentProfile] | None:
    workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (row["workspace_id"],))
    runtime_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (row["runtime_agent_id"],))
    if not workspace_row or not runtime_row:
        return None
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
        id=str(runtime_row["id"]),
        tenant_id=str(runtime_row["tenant_id"]),
        workspace_id=str(runtime_row["workspace_id"]),
        name=str(runtime_row["name"]),
        role=str(runtime_row["role"]),
        status=str(runtime_row["status"]),
        description=str(runtime_row["description"]),
        capabilities=[],
        starters=[],
    )
    return workspace, profile


async def tick_due_sdr_follow_ups() -> int:
    now = datetime.now(timezone.utc).isoformat()
    rows = db.fetch_all(
        """
        SELECT * FROM sdr_sessions
        WHERE follow_up_next_fire_at IS NOT NULL AND follow_up_next_fire_at <= ?
        ORDER BY follow_up_next_fire_at ASC
        """,
        (now,),
    )
    dispatched = 0
    for row in rows:
        fire_at = row.get("follow_up_next_fire_at")
        db.execute(
            """
            UPDATE sdr_sessions
            SET follow_up_next_fire_at = NULL, updated_at = ?
            WHERE id = ? AND follow_up_next_fire_at = ?
            """,
            (now_iso(), row["id"], fire_at),
        )
        current = db.fetch_one("SELECT follow_up_next_fire_at, updated_at FROM sdr_sessions WHERE id = ?", (row["id"],))
        if current and current.get("follow_up_next_fire_at"):
            continue
        if await _execute_follow_up(row):
            dispatched += 1
    return dispatched


async def _execute_follow_up(row: dict[str, Any]) -> bool:
    owner = _session_owner_context(row)
    if owner is None:
        return False
    workspace, profile = owner
    agent_row = db.fetch_one("SELECT * FROM workflow_agents WHERE id = ?", (row["workflow_agent_id"],))
    if not agent_row or not agent_row.get("enabled"):
        return False
    from app.workflow_agents import _agent_from_row

    agent = _agent_from_row(agent_row)
    flow_state = normalize_flow_state(_json_loads(row.get("flow_state_json"), {}))
    if flow_state.get("sessionType") != "channel":
        return False
    rules = to_deterministic_rules(agent.funnel_rules)
    rule = next((item for item in rules if item["key"] == flow_state.get("activeRuleKey")), None)
    if rule is None or not rule.get("followUpEnabled"):
        return False
    follow_ups = [item for item in (rule.get("followUps") or []) if str(item.get("message") or "").strip()]
    sent = int(flow_state.get("followUpSentCount") or 0)
    if sent >= len(follow_ups):
        return False
    next_follow_up = follow_ups[sent]
    if next_follow_up.get("useCustomMessage"):
        text = build_follow_up_text(next_follow_up)
    else:
        text = await agentize_response(
            workspace,
            profile,
            directive=build_follow_up_text(next_follow_up),
            agent_name=agent.name,
            campaign_context=agent.campaign_context,
            answers=flow_state.get("answers") or [],
            kind="followup",
        )
    channel = str(row.get("reply_channel") or "")
    destination = str(row.get("reply_conversation_id") or row.get("reply_sender_id") or "")
    thread_id = str(row.get("reply_thread_id") or "")
    if destination and thread_id:
        destination = f"{destination}:{thread_id}"
    connection_id = str(row.get("reply_connection_id") or "default") or "default"
    if not channel or not destination:
        return False
    await send_message_via_dashboard(
        workspace,
        profile,
        platform=channel,
        connection_id=connection_id,
        destination=destination,
        message=text,
    )
    next_sent = sent + 1
    next_fire: str | None = None
    if next_sent < len(follow_ups):
        next_fire = compute_follow_up_fire_at(follow_ups[next_sent]).isoformat()
    flow_state["followUpSentCount"] = next_sent
    flow_state["followUpNextFireAt"] = next_fire
    flow_state["updatedAt"] = now_iso()
    _save_session(str(row["id"]), flow_state, session_type="channel", follow_up_next_fire_at=next_fire)
    return True
