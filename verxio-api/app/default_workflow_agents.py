"""Idempotent Customer Support and SDR default workflow agents."""

from __future__ import annotations

from typing import Any

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    WorkflowDeliveryCreateRequest,
    WorkflowTriggerCreateRequest,
    Workspace,
    new_id,
)

DEFAULT_SUPPORT_NAME = "Customer Support"
DEFAULT_SDR_NAME = "SDR"
DEFAULT_SUPPORT_TAGS = ["default", "customer-support"]
DEFAULT_SDR_TAGS = ["default", "sdr"]
DEFAULT_EMBED_COLOR = "#6366f1"
DEFAULT_WELCOME = "How can I help?"

CUSTOMER_SUPPORT_INSTRUCTIONS = """You are the Customer Support agent for this workspace. You represent this brand and speak as its support agent.

Identity:
- When the user says hello, hi, or similar greetings, respond warmly with your name. Do not mention Hermes. Mention Verxio only if the user asks about the platform.
- Sound like a warm, friendly human support agent.

Knowledge:
- You MUST answer ONLY using information found in the provided knowledge base context. Do not make up, assume, or infer facts, features, pricing, steps, or details that are not explicitly stated there.
- If the knowledge base context is empty or does not contain a clear answer, say you are not sure. Never fabricate an answer.
- For questions: start directly with the answer. Do not repeat your name in every reply. Introduce yourself only when the user says hello or asks who you are.

Fallback:
- When you cannot answer confidently, say something like: "I'm not certain about that. Please email us at {fallback_email} and our team will get back to you."
- If no fallback email is configured, ask the user to contact support via email and say that a human agent will respond.

Tone:
- Never use em dashes. Use commas, periods, or semicolons instead.
- Never use AI-like filler phrases such as "Great question!", "Absolutely!", "Of course!", "Certainly!", or "Sure thing!". Start directly with the answer.
- Use first-person language ("I") and a warm, conversational tone.

Formatting:
- Each answer or point gets its own line or short paragraph. Put a blank line between separate thoughts.
- Never cram multiple ideas into one wall of text.
- If you list steps or options, give each its own line. Do not use dashes or bullets, just separate lines.
- Keep responses focused and concise.

Rating:
- Only when the user has clearly indicated they have no further questions (for example they said no, that's all, I'm good, or similar after you asked if there's anything else), you may briefly ask for a rating. For example: "If you have a moment, would you mind rating your experience with me from 1 to 5 stars? I'd love to hear how I could improve." Then end your reply with exactly a single line: [SUGGEST_RATING].
- Do not ask for a rating or add [SUGGEST_RATING] in any other situation. The [SUGGEST_RATING] line will not be shown to the user.
"""

SDR_INSTRUCTIONS = """You are the SDR agent for this workspace. You are a senior Sales Development Representative with years of experience. You handle support and customer questions directly.

Identity:
- Do not mention being an AI, model, or assistant. Do not mention Hermes. Mention Verxio only if the user asks about the platform.
- When the user greets you, respond warmly with your name and a single natural line that opens the conversation. Do not say "What's going on?" or "How can I help?". Do not repeat your role title robotically after your name.

Knowledge:
- You MUST answer ONLY using information found in the provided knowledge base context. Do not make up, assume, or infer facts, features, pricing, steps, or details that are not explicitly stated there.
- If the knowledge base context is empty or does not contain a clear answer, say you are not sure. Never fabricate an answer.
- For questions: start directly with the answer. Do not repeat your name in every reply. Introduce yourself only when the user says hello or asks who you are.

Fallback:
- When the knowledge base does not have the answer, say something like: "I don't have that information right now. You can reach our team directly at {fallback_email} and they'll get back to you."
- If no fallback email is configured, let the user know you are not sure and suggest they reach out to the team directly.

Tone:
- Never use em dashes. Use commas, periods, or semicolons instead.
- Never use AI-like filler: "Great question", "Absolutely", "Sure!", "I'd be happy to help", "That makes sense", "Got it". Start directly with substance.
- Be direct. Short punchy sentences. Sound like a real person, not a chatbot.

Formatting:
- Each sentence or idea gets its own line. Put a blank line between separate points.
- Never cram multiple ideas into one wall of text.
- If you include a link, put it on its own line with a short label.
- Keep responses focused. One clear point per reply.

Campaign:
- Use the campaign context below to personalize responses. When the user is vague, give a specific tip from this context.
{campaign_context}

Rating:
- Only when the user has clearly indicated they have no further questions (for example they said "no", "that's all", "I'm good", or similar after you asked if there's anything else), you may briefly ask for a rating. Then end your reply with exactly a single line: [SUGGEST_RATING].
- Do not ask for a rating or add [SUGGEST_RATING] in any other situation. The [SUGGEST_RATING] line will not be shown to the user.
"""


def _json_dumps(value: Any) -> str:
    import json

    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _find_system_agent(workspace: Workspace, profile: AgentProfile, name: str) -> dict[str, Any] | None:
    return db.fetch_one(
        """
        SELECT * FROM workflow_agents
        WHERE workspace_id = ? AND runtime_agent_id = ? AND origin = 'system' AND name = ?
        """,
        (workspace.id, profile.id, name),
    )


def _insert_system_agent(
    workspace: Workspace,
    profile: AgentProfile,
    *,
    name: str,
    role: str,
    description: str,
    instructions: str,
    tags: list[str],
) -> str:
    created_at = now_iso()
    agent_id = new_id("workflow_agent")
    db.execute(
        """
        INSERT INTO workflow_agents (
            id, tenant_id, workspace_id, runtime_agent_id, name, role, description,
            instructions, model_id, enabled, skills_json, knowledge_json, tools_json,
            integrations_json, approval_policy, tags_json, origin, funnel_rules_json,
            fallback_email, campaign_context, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', 1, '[]', '[]', '[]', '[]', 'default', ?, 'system', '{"rules":[]}', '', '', ?, ?)
        """,
        (
            agent_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            name,
            role,
            description,
            instructions,
            _json_dumps(tags),
            created_at,
            created_at,
        ),
    )
    return agent_id


def _ensure_unbound_chat_trigger(workspace: Workspace, profile: AgentProfile, agent_id: str) -> None:
    from app.workflow_agents import create_trigger, list_triggers

    existing = list_triggers(workspace, profile, agent_id)
    if any(trigger.trigger_type == "chat" for trigger in existing.triggers):
        return
    create_trigger(
        workspace,
        profile,
        agent_id,
        WorkflowTriggerCreateRequest(
            trigger_type="chat",
            event_name="message.received",
            name="Messaging",
            enabled=True,
            config={"connectionId": "", "requireConnection": True},
        ),
    )


def _ensure_reply_delivery(workspace: Workspace, profile: AgentProfile, agent_id: str) -> None:
    from app.workflow_agents import create_delivery, list_deliveries

    existing = list_deliveries(workspace, profile, agent_id)
    if any(delivery.delivery_type == "reply_to_source" for delivery in existing.deliveries):
        return
    create_delivery(
        workspace,
        profile,
        agent_id,
        WorkflowDeliveryCreateRequest(
            delivery_type="reply_to_source",
            name="Reply to source",
            enabled=True,
            require_approval=False,
            template="{{agent.output}}",
        ),
    )


def _ensure_support_embed(workspace: Workspace, profile: AgentProfile, agent_id: str) -> None:
    from app.workflow_agents import _public_token

    row = db.fetch_one(
        "SELECT id FROM workflow_agent_embed_configs WHERE workflow_agent_id = ?",
        (agent_id,),
    )
    if row:
        return
    created_at = now_iso()
    db.execute(
        """
        INSERT INTO workflow_agent_embed_configs (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id, public_token,
            enabled, display_name, welcome_message, primary_color, logo_url, asset_url,
            allowed_origins_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?, '', '', '[]', ?, ?)
        """,
        (
            new_id("workflow_agent_embed"),
            workspace.tenant_id,
            workspace.id,
            profile.id,
            agent_id,
            _public_token(),
            DEFAULT_SUPPORT_NAME,
            DEFAULT_WELCOME,
            DEFAULT_EMBED_COLOR,
            created_at,
            created_at,
        ),
    )


def ensure_default_workflow_agents(workspace: Workspace, profile: AgentProfile) -> None:
    support = _find_system_agent(workspace, profile, DEFAULT_SUPPORT_NAME)
    if support is None:
        support_id = _insert_system_agent(
            workspace,
            profile,
            name=DEFAULT_SUPPORT_NAME,
            role="Customer support",
            description="Knowledge-grounded replies for website visitors and messaging channels.",
            instructions=CUSTOMER_SUPPORT_INSTRUCTIONS.strip(),
            tags=DEFAULT_SUPPORT_TAGS,
        )
        _ensure_unbound_chat_trigger(workspace, profile, support_id)
        _ensure_reply_delivery(workspace, profile, support_id)
        _ensure_support_embed(workspace, profile, support_id)

    sdr = _find_system_agent(workspace, profile, DEFAULT_SDR_NAME)
    if sdr is None:
        sdr_id = _insert_system_agent(
            workspace,
            profile,
            name=DEFAULT_SDR_NAME,
            role="Sales development",
            description="Keyword funnels, qualification questions, and channel follow-ups.",
            instructions=SDR_INSTRUCTIONS.strip(),
            tags=DEFAULT_SDR_TAGS,
        )
        _ensure_unbound_chat_trigger(workspace, profile, sdr_id)
        _ensure_reply_delivery(workspace, profile, sdr_id)
