from __future__ import annotations

import base64
import binascii
import json
import os
import re
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from fastapi import HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.knowledge_bases import retrieve_context
from app.models import (
    AgentProfile,
    WorkflowAgentCreateRequest,
    WorkflowAgentRecord,
    WorkflowAgentSetupApprovalRecord,
    WorkflowAgentSetupApprovalRequest,
    WorkflowAgentSetupApprovalResponse,
    WorkflowAgentSetupApplyRequest,
    WorkflowAgentSetupApplyResponse,
    WorkflowAgentSetupDraftData,
    WorkflowAgentSetupDraftRecord,
    WorkflowAgentSetupDraftRequest,
    WorkflowAgentSetupDraftResponse,
    WorkflowAgentSetupDraftUpdateRequest,
    WorkflowAgentsResponse,
    WorkflowAgentUpdateRequest,
    WorkflowCustomToolCreateRequest,
    WorkflowCustomToolRecord,
    WorkflowCustomToolsResponse,
    WorkflowCustomToolUpdateRequest,
    WorkflowAgentEmbedAssetRequest,
    WorkflowAgentEmbedConfigRecord,
    WorkflowAgentEmbedConfigUpdateRequest,
    WorkflowAgentPublicInfo,
    WorkflowAgentPublicRunRequest,
    WorkflowAgentPublicRunResponse,
    WorkflowSetupApprovalRisk,
    WorkflowDeliveriesResponse,
    WorkflowDeliveryCreateRequest,
    WorkflowDeliveryRecord,
    WorkflowDeliveryUpdateRequest,
    WorkflowIntegrationCapabilitiesResponse,
    WorkflowIntegrationCapability,
    WorkflowRunCreateRequest,
    WorkflowRunEventRecord,
    WorkflowRunEventsResponse,
    WorkflowRunRecord,
    WorkflowRunsResponse,
    WorkflowTriggerRunsResponse,
    WorkflowMessagingTriggerRequest,
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
from app.runtime_dashboard import list_toolsets_via_dashboard, run_agent_via_dashboard

STATIC_AGENT_ASSETS_ROOT = Path(__file__).resolve().parent.parent / "static" / "agent-assets"


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


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


def _normalize_method(value: str) -> str:
    method = value.strip().upper()
    allowed = {"GET", "POST", "PUT", "PATCH", "DELETE"}
    if method not in allowed:
        raise HTTPException(status_code=422, detail=f"Unsupported custom tool method '{value}'.")
    return method


def _normalize_auth_type(value: str) -> str:
    auth_type = value.strip().lower() or "none"
    allowed = {"none", "api_key", "bearer"}
    if auth_type not in allowed:
        raise HTTPException(status_code=422, detail=f"Unsupported custom tool auth type '{value}'.")
    return auth_type


def _normalize_env_key(value: str) -> str:
    env_key = value.strip().upper()
    if not env_key:
        return ""
    if not re.fullmatch(r"[A-Z][A-Z0-9_]{1,119}", env_key):
        raise HTTPException(status_code=422, detail="API key env var must look like YOUCAM_API_KEY.")
    return env_key


def _reject_inline_secret(headers: dict[str, str]) -> None:
    for key, value in headers.items():
        combined = f"{key} {value}".lower()
        if "authorization" in combined or "api-key" in combined or "apikey" in combined or "bearer " in combined:
            raise HTTPException(
                status_code=422,
                detail="Do not store raw secrets in custom tool headers. Use the API key env field.",
            )


def _custom_tool_from_row(row: dict[str, Any]) -> WorkflowCustomToolRecord:
    return WorkflowCustomToolRecord(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        workspace_id=str(row["workspace_id"]),
        name=str(row["name"]),
        description=str(row.get("description") or ""),
        method=str(row.get("method") or "POST"),
        url=str(row["url"]),
        auth_type=str(row.get("auth_type") or "api_key"),
        api_key_env=str(row.get("api_key_env") or ""),
        headers=_json_object(_json_loads(row.get("headers_json"), {})),
        request_schema=_json_object(_json_loads(row.get("request_schema_json"), {})),
        response_hint=str(row.get("response_hint") or ""),
        enabled=bool(row.get("enabled", 1)),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _custom_tool_public_spec(tool: WorkflowCustomToolRecord) -> dict[str, Any]:
    return {
        "name": f"custom:{tool.id}",
        "display_name": tool.name,
        "description": tool.description,
        "method": tool.method,
        "url": tool.url,
        "auth_type": tool.auth_type,
        "api_key_env": tool.api_key_env,
        "request_schema": tool.request_schema,
        "response_hint": tool.response_hint,
    }


def _selected_custom_tools(workspace: Workspace, agent: WorkflowAgentRecord) -> list[WorkflowCustomToolRecord]:
    selected_ids = {
        item.removeprefix("custom:")
        for item in agent.tools
        if isinstance(item, str) and item.startswith("custom:") and item.removeprefix("custom:")
    }
    if not selected_ids:
        return []
    return [tool for tool in list_custom_tools(workspace).tools if tool.id in selected_ids and tool.enabled]


def _extract_custom_tool_calls(output: str) -> list[dict[str, Any]]:
    text = output.strip()
    if not text:
        return []
    candidates = [text]
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    if match:
        candidates.insert(0, match.group(1))
    for candidate in candidates:
        try:
            payload = json.loads(candidate)
        except (TypeError, ValueError):
            continue
        calls = payload.get("custom_tool_calls") if isinstance(payload, dict) else None
        if isinstance(calls, list):
            return [call for call in calls if isinstance(call, dict)]
    return []


def _safe_response_preview(value: Any, limit: int = 4000) -> str:
    if isinstance(value, str):
        text = value
    else:
        text = _json_dumps(value)
    return text[:limit] + ("...[truncated]" if len(text) > limit else "")


async def _execute_custom_tool_call(tool: WorkflowCustomToolRecord, arguments: dict[str, Any]) -> dict[str, Any]:
    headers = dict(tool.headers)
    if tool.auth_type in {"api_key", "bearer"}:
        api_key = os.environ.get(tool.api_key_env or "")
        if not api_key:
            raise RuntimeError(f"Missing API key env var {tool.api_key_env} for custom tool {tool.name}.")
        if tool.auth_type == "bearer":
            headers["Authorization"] = f"Bearer {api_key}"
        else:
            headers.setdefault("X-API-Key", api_key)

    timeout = httpx.Timeout(30.0)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        if tool.method == "GET":
            response = await client.get(tool.url, params=arguments, headers=headers)
        else:
            response = await client.request(tool.method, tool.url, json=arguments, headers=headers)
        response.raise_for_status()
        content_type = response.headers.get("content-type", "")
        if "application/json" in content_type:
            body: Any = response.json()
        else:
            body = response.text
    return {
        "tool": f"custom:{tool.id}",
        "display_name": tool.name,
        "status_code": response.status_code,
        "response": body,
    }


async def _execute_requested_custom_tools(
    workspace: Workspace,
    run: WorkflowRunRecord,
    agent: WorkflowAgentRecord,
    output: str,
) -> list[dict[str, Any]]:
    calls = _extract_custom_tool_calls(output)
    if not calls:
        return []
    tools = {f"custom:{tool.id}": tool for tool in _selected_custom_tools(workspace, agent)}
    results: list[dict[str, Any]] = []
    for call in calls[:5]:
        tool_name = str(call.get("tool") or call.get("name") or "").strip()
        tool = tools.get(tool_name)
        if not tool:
            result = {"tool": tool_name, "error": "Custom tool is not selected or is disabled for this agent."}
            results.append(result)
            _record_run_event(run, "custom_tool_rejected", "Rejected custom tool call.", result)
            continue
        arguments = _json_object(call.get("arguments") or call.get("input") or {})
        _record_run_event(
            run,
            "custom_tool_started",
            f"Started custom tool {tool.name}.",
            {"tool": tool_name, "displayName": tool.name, "method": tool.method, "url": tool.url},
        )
        try:
            result = await _execute_custom_tool_call(tool, arguments)
            _record_run_event(
                run,
                "custom_tool_completed",
                f"Completed custom tool {tool.name}.",
                {
                    "tool": tool_name,
                    "displayName": tool.name,
                    "statusCode": result.get("status_code"),
                    "responsePreview": _safe_response_preview(result.get("response"), 1000),
                },
            )
        except Exception as exc:
            result = {"tool": tool_name, "display_name": tool.name, "error": str(exc)}
            _record_run_event(run, "custom_tool_failed", f"Custom tool {tool.name} failed.", result)
        results.append(result)
    return results


def _secret() -> str:
    return secrets.token_urlsafe(24)


def _public_token() -> str:
    return secrets.token_urlsafe(18)


def _base_url(request: Request | None) -> str:
    public_base = os.getenv("VERXIO_PUBLIC_WEB_URL", "").strip().rstrip("/")
    if public_base:
        return public_base
    if request is None:
        return "http://127.0.0.1:8080"
    base = str(request.base_url).rstrip("/")
    return "http://127.0.0.1:8080" if base == "http://127.0.0.1" else base


def _contains_any(text: str, words: list[str]) -> bool:
    return any(word in text for word in words)


def _title_from_prompt(prompt: str) -> str:
    prompt = " ".join(prompt.split())
    lower = prompt.lower()
    if "payment" in lower:
        return "Payment Delivery Agent"
    if "lead" in lower:
        return "Lead Research Agent"
    if "support" in lower or "customer" in lower:
        return "Customer Support Agent"
    if "cosmetic" in lower or "makeup" in lower or "beauty" in lower:
        return "AI Cosmetic Consultant"
    words = [word.strip(".,:;!?()[]{}") for word in prompt.split() if word.strip(".,:;!?()[]{}")]
    title = " ".join(word.capitalize() for word in (words[:4] or ["Workflow"]))
    return title[:180] if "agent" in title.lower() else f"{title} Agent"[:180]


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


def _delivery_from_row(row: dict[str, Any]) -> WorkflowDeliveryRecord:
    payload = dict(row)
    payload["enabled"] = bool(payload.get("enabled"))
    payload["require_approval"] = bool(payload.get("require_approval"))
    payload["config"] = _json_loads(payload.pop("config_json", "{}"), {})
    return WorkflowDeliveryRecord(**payload)


def _embed_config_from_row(row: dict[str, Any], request: Request | None = None) -> WorkflowAgentEmbedConfigRecord:
    payload = dict(row)
    payload["enabled"] = bool(payload.get("enabled"))
    payload["allowed_origins"] = _json_loads(payload.pop("allowed_origins_json", "[]"), [])
    base = _base_url(request)
    token = str(payload.get("public_token") or "")
    payload["share_url"] = f"{base}/agent/{token}" if base and token else ""
    payload["embed_script"] = (
        f'<script src="{base}/api/public/workflow-agent-embed.js" data-agent-token="{token}" async></script>'
        if base and token
        else ""
    )
    return WorkflowAgentEmbedConfigRecord(**payload)


def _setup_draft_from_row(row: dict[str, Any]) -> WorkflowAgentSetupDraftRecord:
    payload = dict(row)
    payload["draft"] = _json_loads(payload.pop("draft_json", "{}"), {})
    payload["approvals_required"] = _json_loads(payload.pop("approvals_required_json", "[]"), [])
    return WorkflowAgentSetupDraftRecord(**payload)


def _setup_approval_from_row(row: dict[str, Any]) -> WorkflowAgentSetupApprovalRecord:
    payload = dict(row)
    payload["metadata"] = _json_loads(payload.pop("metadata_json", "{}"), {})
    return WorkflowAgentSetupApprovalRecord(**payload)


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


def _validate_delivery_payload(
    delivery_type: str,
    *,
    channel: str = "",
    destination: str = "",
    config: dict[str, Any] | None = None,
) -> None:
    config = config or {}
    if delivery_type == "send_message" and not (channel.strip() and destination.strip()):
        raise HTTPException(status_code=422, detail="Send-message deliveries require channel and destination.")
    if delivery_type == "reply_to_source" and not channel.strip():
        raise HTTPException(status_code=422, detail="Reply-to-source deliveries require a channel.")
    if delivery_type == "webhook_callback":
        url = str(config.get("url") or destination or "").strip()
        if not (url.startswith("https://") or url.startswith("http://")):
            raise HTTPException(status_code=422, detail="Webhook callback deliveries require an http(s) URL.")
    if delivery_type == "composio_action":
        action = str(config.get("action") or "").strip()
        app_slug = str(config.get("appSlug") or config.get("app_slug") or channel or "").strip()
        if not app_slug or not action:
            raise HTTPException(status_code=422, detail="Composio action deliveries require appSlug and action.")


def _setup_approval_risks(draft: WorkflowAgentSetupDraftData) -> list[WorkflowSetupApprovalRisk]:
    risks: list[WorkflowSetupApprovalRisk] = []
    for trigger in draft.triggers:
        text = _json_dumps(trigger.model_dump()).lower()
        if trigger.trigger_type == "chat" and _contains_any(
            text,
            ["all", "any", "every", "whatsapp", "telegram", "slack", "discord"],
        ):
            risks.append("broad_messaging_trigger")
        if trigger.trigger_type == "webhook" and _contains_any(text, ["callback", "public"]):
            risks.append("webhook_callback")
    for delivery in draft.deliveries:
        text = _json_dumps(delivery.model_dump()).lower()
        if delivery.delivery_type not in {"none", "save_only"} or delivery.channel:
            risks.append("external_delivery")
        if _contains_any(text, ["callback", "webhook"]):
            risks.append("webhook_callback")
    if _contains_any(" ".join(draft.agent.tools).lower(), ["api", "key", "paid", "youcam"]):
        risks.append("paid_or_key_backed_tool")
    return sorted(set(risks))


def _draft_from_prompt(prompt: str, *, existing: WorkflowAgentRecord | None = None) -> WorkflowAgentSetupDraftData:
    text = prompt.lower()
    integrations = list(existing.integrations if existing else [])
    knowledge = list(existing.knowledge if existing else [])
    skills = list(existing.skills if existing else [])
    tools = list(existing.tools if existing else [])
    triggers: list[dict[str, Any]] = []
    deliveries: list[dict[str, Any]] = []
    missing: list[str] = []
    notes = ["Generated setup is a draft. Risky external actions stay disabled until approved."]

    for keyword, slug in {
        "airtable": "airtable",
        "discord": "discord",
        "gmail": "gmail",
        "hubspot": "hubspot",
        "paystack": "paystack",
        "slack": "slack",
        "stripe": "stripe",
        "telegram": "telegram",
        "whatsapp": "whatsapp",
    }.items():
        if keyword in text:
            integrations.append(slug)

    for keyword, tool in {
        "email": "send_email",
        "gmail": "send_email",
        "research": "web_research",
        "search": "web_search",
        "slack": "send_slack_message",
        "telegram": "send_telegram_message",
        "whatsapp": "send_whatsapp",
        "youcam": "youcam_api",
    }.items():
        if keyword in text:
            tools.append(tool)

    if _contains_any(text, ["lead", "score", "qualify"]):
        skills.append("lead-scoring")
    if _contains_any(text, ["support", "customer", "faq", "policy"]):
        skills.append("support-triage")
    if _contains_any(text, ["beauty", "cosmetic", "makeup", "skin"]):
        skills.append("product-consultation")
    if _contains_any(text, ["faq", "kb", "knowledge", "playbook", "policy"]):
        knowledge.append("needs-knowledge-base")
        missing.append("Attach or create the knowledge base this agent should use.")

    if _contains_any(text, ["paystack", "payment", "stripe", "webhook"]):
        triggers.append(
            {
                "trigger_type": "webhook",
                "event_name": "payment.succeeded" if _contains_any(text, ["paystack", "payment", "stripe"]) else "external.event",
                "name": "External webhook",
                "enabled": False,
                "config": {"version": 1},
                "requires_approval": True,
            }
        )
    if _contains_any(text, ["daily", "every ", "hourly", "schedule"]):
        triggers.append(
            {
                "trigger_type": "schedule",
                "event_name": "scheduled.run",
                "name": "Scheduled run",
                "enabled": False,
                "config": {"version": 1, "everyMinutes": 60},
            }
        )
    if _contains_any(text, ["discord", "message", "slack", "telegram", "whatsapp"]):
        channel = next((item for item in ["whatsapp", "telegram", "slack", "discord"] if item in text), "messaging")
        triggers.append(
            {
                "trigger_type": "chat",
                "event_name": f"{channel}.message",
                "name": f"{channel.title()} message",
                "enabled": False,
                "config": {"version": 1, "channel": channel, "match": "draft"},
                "requires_approval": True,
            }
        )
        deliveries.append(
            {
                "delivery_type": "reply_to_source",
                "channel": channel,
                "destination": "trigger.source",
                "template": "{{agent.output}}",
                "enabled": False,
                "require_approval": True,
                "config": {"version": 1},
            }
        )
    if _contains_any(text, ["embed", "public url", "share link", "site", "website"]):
        triggers.append(
            {
                "trigger_type": "api",
                "event_name": "embed.submitted",
                "name": "Website embed",
                "enabled": False,
                "config": {"version": 1, "source": "embed"},
                "requires_approval": True,
            }
        )
        missing.append("Configure embed branding, allowed domains, and asset uploads before publishing.")

    if _contains_any(text, ["delivery", "email", "notify", "reply", "send"]) and not deliveries:
        channel = next((item for item in ["whatsapp", "telegram", "slack", "discord", "gmail", "email"] if item in text), "")
        deliveries.append(
            {
                "delivery_type": "send_message" if channel else "save_only",
                "channel": "gmail" if channel == "email" else channel,
                "destination": "from_trigger_payload" if channel else "",
                "template": "{{agent.output}}",
                "enabled": False,
                "require_approval": bool(channel),
                "config": {"version": 1},
            }
        )

    if existing and existing.role:
        role = existing.role
    elif "payment" in text:
        role = "Notify customers and teams after successful payment events"
    elif "lead" in text:
        role = "Research, qualify, and prepare next actions for leads"
    elif "support" in text or "customer" in text:
        role = "Answer customer questions and escalate when needed"
    elif "cosmetic" in text or "youcam" in text:
        role = "Recommend cosmetic products with approved tools and knowledge"
    else:
        role = "Complete the described workflow with configured capabilities"

    base_instructions = existing.instructions if existing else ""
    instructions = "\n".join(
        part
        for part in [
            base_instructions,
            "User goal:",
            prompt.strip(),
            "Use only configured skills, tools, integrations, and knowledge sources.",
            "Ask for approval before external delivery, broad messaging, public links, paid tools, or destructive changes.",
        ]
        if part.strip()
    )

    return WorkflowAgentSetupDraftData(
        agent=WorkflowAgentCreateRequest(
            approval_policy="ask_before_external_actions",
            description=(existing.description if existing else "Generated from setup prompt.")[:1000],
            enabled=False,
            instructions=instructions[:12000],
            integrations=_string_list(integrations),
            knowledge=_string_list(knowledge),
            model_id=existing.model_id if existing else "",
            name=(existing.name if existing else _title_from_prompt(prompt))[:180],
            role=role[:240],
            skills=_string_list(skills),
            tools=_string_list(tools),
        ),
        deliveries=deliveries,
        missing=_string_list(missing),
        notes=notes,
        triggers=triggers,
    )


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
        tools=_string_list(item.get("tools")),
        enabled=bool(item.get("enabled", True)),
    )


async def list_skill_capabilities() -> WorkflowSkillCapabilitiesResponse:
    metadata = await HermesRuntimeAdapter().metadata()
    skills = [skill for item in metadata.skills if (skill := _skill_from_payload(item))]
    skills.sort(key=lambda item: item.name.lower())
    return WorkflowSkillCapabilitiesResponse(skills=skills, errors=metadata.errors)


async def list_tool_capabilities(workspace: Workspace, profile: AgentProfile | None = None) -> WorkflowToolCapabilitiesResponse:
    errors: list[str] = []
    if profile is not None:
        try:
            toolsets = await list_toolsets_via_dashboard(workspace, profile)
        except HTTPException as exc:
            errors.append(str(exc.detail))
            metadata = await HermesRuntimeAdapter().metadata()
            toolsets = metadata.toolsets
            errors.extend(metadata.errors)
    else:
        metadata = await HermesRuntimeAdapter().metadata()
        toolsets = metadata.toolsets
        errors.extend(metadata.errors)

    seen: set[str] = set()
    tools: list[WorkflowToolCapability] = []
    for item in toolsets:
        if isinstance(item, dict) and isinstance(item.get("tools"), list):
            name = str(item.get("name") or item.get("id") or item.get("slug") or "").strip()
            if not name or name in seen:
                continue
            toolset_enabled = bool(item.get("enabled", True))
            toolset_configured = bool(item.get("configured", True))
            child_tools: list[str] = []
            for candidate in item["tools"]:
                child = _tool_from_payload(candidate, name)
                if child:
                    child_tools.append(child.name)
            tools.append(
                WorkflowToolCapability(
                    name=name,
                    display_name=str(item.get("label") or item.get("display_name") or name),
                    description=str(item.get("description") or item.get("summary") or ""),
                    category=str(item.get("category") or "toolset"),
                    source="hermes_toolset",
                    tools=child_tools,
                    enabled=bool(toolset_enabled and toolset_configured),
                    configured=toolset_configured,
                )
            )
            seen.add(name)
            continue

        tool = _tool_from_payload(item)
        if tool and tool.name not in seen:
            seen.add(tool.name)
            tools.append(tool)
    for custom_tool in list_custom_tools(workspace).tools:
        name = f"custom:{custom_tool.id}"
        tools.append(
            WorkflowToolCapability(
                id=custom_tool.id,
                name=name,
                display_name=custom_tool.name,
                description=custom_tool.description,
                category="custom api",
                source="custom",
                enabled=custom_tool.enabled,
                auth_type=custom_tool.auth_type,
                api_key_env=custom_tool.api_key_env,
                configured=custom_tool.auth_type == "none" or bool(custom_tool.api_key_env),
                method=custom_tool.method,
                url=custom_tool.url,
            )
        )
    tools.sort(key=lambda item: (item.category.lower(), item.name.lower()))
    return WorkflowToolCapabilitiesResponse(tools=tools, errors=errors)


def list_custom_tools(workspace: Workspace) -> WorkflowCustomToolsResponse:
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_custom_tools
        WHERE workspace_id = ?
        ORDER BY updated_at DESC, name ASC
        """,
        (workspace.id,),
    )
    return WorkflowCustomToolsResponse(tools=[_custom_tool_from_row(row) for row in rows])


def create_custom_tool(workspace: Workspace, payload: WorkflowCustomToolCreateRequest) -> WorkflowCustomToolRecord:
    headers = dict(payload.headers)
    _reject_inline_secret(headers)
    auth_type = _normalize_auth_type(payload.auth_type)
    api_key_env = _normalize_env_key(payload.api_key_env)
    if auth_type in {"api_key", "bearer"} and not api_key_env:
        raise HTTPException(status_code=422, detail="API key env var is required for this auth type.")
    created_at = now_iso()
    tool_id = new_id("workflow_tool")
    db.execute(
        """
        INSERT INTO workflow_custom_tools (
            id, tenant_id, workspace_id, name, description, method, url, auth_type,
            api_key_env, headers_json, request_schema_json, response_hint, enabled,
            created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            tool_id,
            workspace.tenant_id,
            workspace.id,
            payload.name.strip(),
            payload.description.strip(),
            _normalize_method(payload.method),
            payload.url.strip(),
            auth_type,
            api_key_env,
            _json_dumps(headers),
            _json_dumps(payload.request_schema),
            payload.response_hint.strip(),
            1 if payload.enabled else 0,
            created_at,
            created_at,
        ),
    )
    return get_custom_tool(workspace, tool_id)


def get_custom_tool(workspace: Workspace, tool_id: str) -> WorkflowCustomToolRecord:
    row = db.fetch_one(
        "SELECT * FROM workflow_custom_tools WHERE id = ? AND workspace_id = ?",
        (tool_id, workspace.id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Custom tool not found.")
    return _custom_tool_from_row(row)


def update_custom_tool(
    workspace: Workspace,
    tool_id: str,
    payload: WorkflowCustomToolUpdateRequest,
) -> WorkflowCustomToolRecord:
    current = get_custom_tool(workspace, tool_id)
    data = current.model_dump()
    updates = payload.model_dump(exclude_unset=True)
    data.update({key: value for key, value in updates.items() if value is not None})
    headers = dict(data.get("headers") or {})
    _reject_inline_secret(headers)
    auth_type = _normalize_auth_type(str(data.get("auth_type") or "none"))
    api_key_env = _normalize_env_key(str(data.get("api_key_env") or ""))
    if auth_type in {"api_key", "bearer"} and not api_key_env:
        raise HTTPException(status_code=422, detail="API key env var is required for this auth type.")
    db.execute(
        """
        UPDATE workflow_custom_tools
        SET name = ?, description = ?, method = ?, url = ?, auth_type = ?, api_key_env = ?,
            headers_json = ?, request_schema_json = ?, response_hint = ?, enabled = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ?
        """,
        (
            str(data["name"]).strip(),
            str(data.get("description") or "").strip(),
            _normalize_method(str(data.get("method") or "POST")),
            str(data["url"]).strip(),
            auth_type,
            api_key_env,
            _json_dumps(headers),
            _json_dumps(_json_object(data.get("request_schema"))),
            str(data.get("response_hint") or "").strip(),
            1 if data.get("enabled") else 0,
            now_iso(),
            tool_id,
            workspace.id,
        ),
    )
    return get_custom_tool(workspace, tool_id)


def delete_custom_tool(workspace: Workspace, tool_id: str) -> dict[str, bool]:
    get_custom_tool(workspace, tool_id)
    db.execute(
        "DELETE FROM workflow_custom_tools WHERE id = ? AND workspace_id = ?",
        (tool_id, workspace.id),
    )
    return {"ok": True}


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
    agent_rows = db.fetch_all(
        """
        SELECT * FROM workflow_agents
        WHERE workspace_id = ? AND runtime_agent_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id),
    )
    draft_rows = db.fetch_all(
        """
        SELECT * FROM workflow_agent_setup_drafts
        WHERE workspace_id = ? AND runtime_agent_id = ? AND status = 'draft'
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id),
    )
    return WorkflowAgentsResponse(
        agents=[_agent_from_row(row) for row in agent_rows],
        setup_drafts=[_setup_draft_from_row(row) for row in draft_rows],
    )


def _approval_action_for_risk(risk: WorkflowSetupApprovalRisk) -> str:
    return {
        "broad_messaging_trigger": "Enable broad inbound messaging trigger",
        "destructive_change": "Apply destructive agent setup change",
        "external_delivery": "Enable external delivery",
        "paid_or_key_backed_tool": "Allow paid or API-key-backed tool",
        "public_link": "Create public embed or share link",
        "webhook_callback": "Enable webhook callback",
    }[risk]


def _approvals_for_draft(draft_id: str) -> list[WorkflowAgentSetupApprovalRecord]:
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_agent_setup_approvals
        WHERE setup_draft_id = ?
        ORDER BY created_at ASC
        """,
        (draft_id,),
    )
    return [_setup_approval_from_row(row) for row in rows]


def _insert_setup_approval(
    workspace: Workspace,
    profile: AgentProfile,
    *,
    draft_id: str,
    risk: WorkflowSetupApprovalRisk,
    workflow_agent_id: str | None,
    metadata: dict[str, Any],
) -> None:
    created_at = now_iso()
    db.execute(
        """
        INSERT INTO workflow_agent_setup_approvals (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id,
            setup_draft_id, risk_type, action, status, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)
        """,
        (
            new_id("workflow_approval"),
            workspace.tenant_id,
            workspace.id,
            profile.id,
            workflow_agent_id,
            draft_id,
            risk,
            _approval_action_for_risk(risk),
            _json_dumps(metadata),
            created_at,
            created_at,
        ),
    )


def create_setup_draft(
    workspace: Workspace,
    profile: AgentProfile,
    payload: WorkflowAgentSetupDraftRequest,
) -> WorkflowAgentSetupDraftResponse:
    draft = _draft_from_prompt(payload.prompt)
    risks = _setup_approval_risks(draft)
    created_at = now_iso()
    draft_id = new_id("workflow_setup")
    db.execute(
        """
        INSERT INTO workflow_agent_setup_drafts (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id,
            source, prompt, status, draft_json, approvals_required_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, NULL, ?, ?, 'draft', ?, ?, ?, ?)
        """,
        (
            draft_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            payload.source,
            payload.prompt.strip(),
            _json_dumps(draft.model_dump()),
            _json_dumps(risks),
            created_at,
            created_at,
        ),
    )
    for risk in risks:
        _insert_setup_approval(
            workspace,
            profile,
            draft_id=draft_id,
            metadata={"source": payload.source},
            risk=risk,
            workflow_agent_id=None,
        )
    row = db.fetch_one("SELECT * FROM workflow_agent_setup_drafts WHERE id = ?", (draft_id,))
    return WorkflowAgentSetupDraftResponse(draft=_setup_draft_from_row(row or {}), approvals=_approvals_for_draft(draft_id))


def create_setup_update_draft(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowAgentSetupDraftUpdateRequest,
) -> WorkflowAgentSetupDraftResponse:
    existing = get_agent(workspace, profile, agent_id)
    draft = _draft_from_prompt(payload.prompt, existing=existing)
    risks = _setup_approval_risks(draft)
    created_at = now_iso()
    draft_id = new_id("workflow_setup")
    db.execute(
        """
        INSERT INTO workflow_agent_setup_drafts (
            id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id,
            source, prompt, status, draft_json, approvals_required_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
        """,
        (
            draft_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            agent_id,
            payload.source,
            payload.prompt.strip(),
            _json_dumps(draft.model_dump()),
            _json_dumps(risks),
            created_at,
            created_at,
        ),
    )
    for risk in risks:
        _insert_setup_approval(
            workspace,
            profile,
            draft_id=draft_id,
            metadata={"source": payload.source},
            risk=risk,
            workflow_agent_id=agent_id,
        )
    row = db.fetch_one("SELECT * FROM workflow_agent_setup_drafts WHERE id = ?", (draft_id,))
    return WorkflowAgentSetupDraftResponse(draft=_setup_draft_from_row(row or {}), approvals=_approvals_for_draft(draft_id))


def update_setup_approvals(
    workspace: Workspace,
    profile: AgentProfile,
    payload: WorkflowAgentSetupApprovalRequest,
) -> WorkflowAgentSetupApprovalResponse:
    if payload.status == "pending":
        raise HTTPException(status_code=422, detail="Approval status must be approved or rejected.")
    if not payload.approval_ids:
        raise HTTPException(status_code=422, detail="Select at least one setup approval.")
    now = now_iso()
    placeholders = ",".join("?" for _ in payload.approval_ids)
    rows = db.fetch_all(
        f"""
        SELECT * FROM workflow_agent_setup_approvals
        WHERE workspace_id = ? AND runtime_agent_id = ? AND id IN ({placeholders})
        """,
        (workspace.id, profile.id, *payload.approval_ids),
    )
    if len(rows) != len(set(payload.approval_ids)):
        raise HTTPException(status_code=404, detail="One or more setup approvals were not found.")
    db.execute(
        f"""
        UPDATE workflow_agent_setup_approvals
        SET status = ?, updated_at = ?
        WHERE workspace_id = ? AND runtime_agent_id = ? AND id IN ({placeholders})
        """,
        (payload.status, now, workspace.id, profile.id, *payload.approval_ids),
    )
    updated = db.fetch_all(
        f"""
        SELECT * FROM workflow_agent_setup_approvals
        WHERE workspace_id = ? AND runtime_agent_id = ? AND id IN ({placeholders})
        ORDER BY created_at ASC
        """,
        (workspace.id, profile.id, *payload.approval_ids),
    )
    return WorkflowAgentSetupApprovalResponse(approvals=[_setup_approval_from_row(row) for row in updated])


def apply_setup_draft(
    workspace: Workspace,
    profile: AgentProfile,
    payload: WorkflowAgentSetupApplyRequest,
    request: Request | None = None,
) -> WorkflowAgentSetupApplyResponse:
    row = db.fetch_one(
        """
        SELECT * FROM workflow_agent_setup_drafts
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (payload.setup_draft_id, workspace.id, profile.id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workflow setup draft not found.")
    draft_record = _setup_draft_from_row(row)
    approvals = _approvals_for_draft(draft_record.id)
    if any(approval.status == "rejected" for approval in approvals):
        raise HTTPException(status_code=409, detail="Rejected setup approvals must be resolved before applying this draft.")
    if any(approval.status == "pending" for approval in approvals):
        raise HTTPException(status_code=409, detail="Approve required setup actions before applying this draft.")

    agent_input = draft_record.draft.agent
    if draft_record.workflow_agent_id:
        agent = update_agent(workspace, profile, draft_record.workflow_agent_id, WorkflowAgentUpdateRequest(**agent_input.model_dump()))
    else:
        agent = create_agent(workspace, profile, agent_input)

    created_triggers: list[WorkflowTriggerRecord] = []
    for trigger in draft_record.draft.triggers:
        created_triggers.append(
            create_trigger(
                workspace,
                profile,
                agent.id,
                WorkflowTriggerCreateRequest(
                    config=trigger.config,
                    enabled=payload.enable_created_records and trigger.enabled,
                    event_name=trigger.event_name,
                    name=trigger.name,
                    trigger_type=trigger.trigger_type,
                ),
                request,
            )
        )

    created_deliveries: list[WorkflowDeliveryRecord] = []
    for delivery in draft_record.draft.deliveries:
        created_deliveries.append(
            create_delivery(
                workspace,
                profile,
                agent.id,
                WorkflowDeliveryCreateRequest(
                    channel=delivery.channel,
                    config=delivery.config,
                    delivery_type=delivery.delivery_type,
                    destination=delivery.destination,
                    enabled=payload.enable_created_records and delivery.enabled,
                    name=delivery.channel or delivery.delivery_type,
                    require_approval=delivery.require_approval,
                    template=delivery.template,
                ),
            )
        )

    db.execute(
        """
        UPDATE workflow_agent_setup_drafts
        SET workflow_agent_id = ?, status = 'applied', updated_at = ?
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (agent.id, now_iso(), draft_record.id, workspace.id, profile.id),
    )
    return WorkflowAgentSetupApplyResponse(
        agent=agent,
        approvals=approvals,
        deliveries=created_deliveries,
        triggers=created_triggers,
    )


def create_agent(workspace: Workspace, profile: AgentProfile, payload: WorkflowAgentCreateRequest) -> WorkflowAgentRecord:
    created_at = now_iso()
    agent_id = new_id("workflow_agent")
    db.execute(
        """
        INSERT INTO workflow_agents (
            id, tenant_id, workspace_id, runtime_agent_id, name, role, description,
            instructions, model_id, enabled, skills_json, knowledge_json, tools_json,
            integrations_json, approval_policy, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            payload.model_id.strip(),
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
        SET name = ?, role = ?, description = ?, instructions = ?, model_id = ?, enabled = ?,
            skills_json = ?, knowledge_json = ?, tools_json = ?, integrations_json = ?,
            approval_policy = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (
            str(data["name"]).strip(),
            str(data.get("role") or "").strip(),
            str(data.get("description") or "").strip(),
            str(data.get("instructions") or "").strip(),
            str(data.get("model_id") or "").strip(),
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


def list_deliveries(workspace: Workspace, profile: AgentProfile, agent_id: str) -> WorkflowDeliveriesResponse:
    get_agent(workspace, profile, agent_id)
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_deliveries
        WHERE workspace_id = ? AND workflow_agent_id = ?
        ORDER BY created_at DESC
        """,
        (workspace.id, agent_id),
    )
    return WorkflowDeliveriesResponse(deliveries=[_delivery_from_row(row) for row in rows])


def create_delivery(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowDeliveryCreateRequest,
) -> WorkflowDeliveryRecord:
    get_agent(workspace, profile, agent_id)
    config = payload.config if isinstance(payload.config, dict) else {}
    _validate_delivery_payload(
        payload.delivery_type,
        channel=payload.channel,
        destination=payload.destination,
        config=config,
    )
    created_at = now_iso()
    delivery_id = new_id("workflow_delivery")
    db.execute(
        """
        INSERT INTO workflow_deliveries (
            id, tenant_id, workspace_id, workflow_agent_id, delivery_type, name, channel,
            destination, template, enabled, require_approval, config_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            delivery_id,
            workspace.tenant_id,
            workspace.id,
            agent_id,
            payload.delivery_type,
            payload.name.strip(),
            payload.channel.strip(),
            payload.destination.strip(),
            payload.template,
            1 if payload.enabled else 0,
            1 if payload.require_approval else 0,
            _json_dumps(config),
            created_at,
            created_at,
        ),
    )
    return get_delivery(workspace, profile, agent_id, delivery_id)


def get_delivery(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    delivery_id: str,
) -> WorkflowDeliveryRecord:
    get_agent(workspace, profile, agent_id)
    row = db.fetch_one(
        """
        SELECT * FROM workflow_deliveries
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (delivery_id, workspace.id, agent_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Workflow delivery not found.")
    return _delivery_from_row(row)


def update_delivery(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    delivery_id: str,
    payload: WorkflowDeliveryUpdateRequest,
) -> WorkflowDeliveryRecord:
    current = get_delivery(workspace, profile, agent_id, delivery_id)
    data = current.model_dump()
    updates = payload.model_dump(exclude_unset=True)
    data.update({key: value for key, value in updates.items() if value is not None})
    config = data.get("config") if isinstance(data.get("config"), dict) else {}
    _validate_delivery_payload(
        current.delivery_type,
        channel=str(data.get("channel") or ""),
        destination=str(data.get("destination") or ""),
        config=config,
    )
    db.execute(
        """
        UPDATE workflow_deliveries
        SET name = ?, channel = ?, destination = ?, template = ?, enabled = ?,
            require_approval = ?, config_json = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (
            str(data.get("name") or "").strip(),
            str(data.get("channel") or "").strip(),
            str(data.get("destination") or "").strip(),
            str(data.get("template") or ""),
            1 if data.get("enabled") else 0,
            1 if data.get("require_approval") else 0,
            _json_dumps(config),
            now_iso(),
            delivery_id,
            workspace.id,
            agent_id,
        ),
    )
    return get_delivery(workspace, profile, agent_id, delivery_id)


def delete_delivery(workspace: Workspace, profile: AgentProfile, agent_id: str, delivery_id: str) -> dict[str, bool]:
    get_delivery(workspace, profile, agent_id, delivery_id)
    db.execute(
        "DELETE FROM workflow_deliveries WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?",
        (delivery_id, workspace.id, agent_id),
    )
    return {"ok": True}


def _normalize_hex_color(value: str) -> str:
    text = value.strip()
    if re.fullmatch(r"#[0-9a-fA-F]{6}", text):
        return text.lower()
    raise HTTPException(status_code=400, detail="Primary color must be a 6-digit hex color.")


def _allowed_origins(value: list[str] | None) -> list[str]:
    origins: list[str] = []
    for item in value or []:
        text = str(item).strip()
        if not text:
            continue
        if text == "*" or text.startswith(("http://", "https://")):
            origins.append(text)
            continue
        raise HTTPException(status_code=400, detail="Allowed origins must be http(s) URLs or '*'.")
    return origins[:25]


def _ensure_embed_config(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    request: Request | None = None,
) -> WorkflowAgentEmbedConfigRecord:
    agent = get_agent(workspace, profile, agent_id)
    row = db.fetch_one("SELECT * FROM workflow_agent_embed_configs WHERE workflow_agent_id = ?", (agent_id,))
    if not row:
        created_at = now_iso()
        db.execute(
            """
            INSERT INTO workflow_agent_embed_configs (
                id, tenant_id, workspace_id, runtime_agent_id, workflow_agent_id, public_token,
                enabled, display_name, welcome_message, primary_color, logo_url, asset_url,
                allowed_origins_json, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, '#0ea5e9', '', '', '[]', ?, ?)
            """,
            (
                new_id("workflow_agent_embed"),
                workspace.tenant_id,
                workspace.id,
                profile.id,
                agent_id,
                _public_token(),
                agent.name,
                "How can I help?",
                created_at,
                created_at,
            ),
        )
        row = db.fetch_one("SELECT * FROM workflow_agent_embed_configs WHERE workflow_agent_id = ?", (agent_id,))
    return _embed_config_from_row(row or {}, request)


def get_embed_config(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    request: Request | None = None,
) -> WorkflowAgentEmbedConfigRecord:
    return _ensure_embed_config(workspace, profile, agent_id, request)


def update_embed_config(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowAgentEmbedConfigUpdateRequest,
    request: Request | None = None,
) -> WorkflowAgentEmbedConfigRecord:
    current = _ensure_embed_config(workspace, profile, agent_id, request)
    data = current.model_dump()
    updates = payload.model_dump(exclude_unset=True)
    data.update({key: value for key, value in updates.items() if value is not None})
    allowed_origins = _allowed_origins(data.get("allowed_origins") if isinstance(data.get("allowed_origins"), list) else [])
    primary_color = _normalize_hex_color(str(data.get("primary_color") or "#0ea5e9"))
    db.execute(
        """
        UPDATE workflow_agent_embed_configs
        SET enabled = ?, display_name = ?, welcome_message = ?, primary_color = ?,
            logo_url = ?, asset_url = ?, allowed_origins_json = ?, updated_at = ?
        WHERE workflow_agent_id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (
            1 if data.get("enabled") else 0,
            str(data.get("display_name") or "").strip(),
            str(data.get("welcome_message") or "").strip(),
            primary_color,
            str(data.get("logo_url") or "").strip(),
            str(data.get("asset_url") or "").strip(),
            _json_dumps(allowed_origins),
            now_iso(),
            agent_id,
            workspace.id,
            profile.id,
        ),
    )
    return _ensure_embed_config(workspace, profile, agent_id, request)


def upload_embed_asset(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowAgentEmbedAssetRequest,
    request: Request | None = None,
) -> WorkflowAgentEmbedConfigRecord:
    _ensure_embed_config(workspace, profile, agent_id, request)
    data_url = payload.data_url.strip()
    if not data_url.startswith("data:") or "," not in data_url:
        raise HTTPException(status_code=400, detail="Asset must be a data URL.")
    header, encoded = data_url.split(",", 1)
    if ";base64" not in header:
        raise HTTPException(status_code=400, detail="Asset payload must be base64 encoded.")
    mime = header[5:].split(";", 1)[0].strip().lower()
    allowed = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/svg+xml": ".svg"}
    if mime not in allowed:
        raise HTTPException(status_code=400, detail="Asset must be a PNG, JPG, WebP, or SVG image.")
    try:
        content = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=400, detail="Asset payload is not valid base64.") from exc
    if len(content) > 2_000_000:
        raise HTTPException(status_code=413, detail="Asset must be 2MB or smaller.")
    STATIC_AGENT_ASSETS_ROOT.mkdir(parents=True, exist_ok=True)
    asset_name = f"{agent_id}-{secrets.token_hex(8)}{allowed[mime]}"
    (STATIC_AGENT_ASSETS_ROOT / asset_name).write_bytes(content)
    asset_url = f"{_base_url(request)}/static/agent-assets/{asset_name}" if request else f"/static/agent-assets/{asset_name}"
    return update_embed_config(workspace, profile, agent_id, WorkflowAgentEmbedConfigUpdateRequest(asset_url=asset_url), request)


def _public_embed_row(public_token: str, *, require_enabled: bool = True) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT c.*, a.name AS agent_name, a.description AS agent_description, a.enabled AS agent_enabled
        FROM workflow_agent_embed_configs c
        JOIN workflow_agents a ON a.id = c.workflow_agent_id
        WHERE c.public_token = ?
        """,
        (public_token,),
    )
    if not row or not row.get("agent_enabled") or (require_enabled and not row.get("enabled")):
        raise HTTPException(status_code=404, detail="Public workflow agent is not available.")
    return row


def get_public_embed_info(public_token: str) -> WorkflowAgentPublicInfo:
    row = _public_embed_row(public_token, require_enabled=False)
    return WorkflowAgentPublicInfo(
        public_token=str(row["public_token"]),
        name=str(row["agent_name"]),
        description=str(row["agent_description"] or ""),
        display_name=str(row["display_name"] or row["agent_name"]),
        welcome_message=str(row["welcome_message"] or "How can I help?"),
        primary_color=str(row["primary_color"] or "#0ea5e9"),
        logo_url=str(row["logo_url"] or ""),
        asset_url=str(row["asset_url"] or ""),
    )


def _assert_public_origin_allowed(row: dict[str, Any], request: Request) -> None:
    allowed = _json_loads(row.get("allowed_origins_json"), [])
    if not allowed or "*" in allowed:
        return
    origin = request.headers.get("origin") or ""
    if origin not in allowed:
        raise HTTPException(status_code=403, detail="This origin is not allowed to run the agent.")


async def run_public_embed_agent(
    public_token: str,
    payload: WorkflowAgentPublicRunRequest,
    request: Request,
) -> WorkflowAgentPublicRunResponse:
    row = _public_embed_row(public_token, require_enabled=True)
    _assert_public_origin_allowed(row, request)
    workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (row["workspace_id"],))
    runtime_agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (row["runtime_agent_id"],))
    if not workspace_row or not runtime_agent_row:
        raise HTTPException(status_code=404, detail="Public workflow agent owner not found.")
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
    run = await run_agent(
        workspace,
        profile,
        str(row["workflow_agent_id"]),
        WorkflowRunCreateRequest(
            input={
                "event": "embed.submitted",
                "payload": {
                    **payload.input,
                    "message": payload.message,
                    "page_url": payload.page_url,
                    "public_token": public_token,
                    "visitor_id": payload.visitor_id,
                },
            }
        ),
        trigger_type="api",
    )
    return WorkflowAgentPublicRunResponse(run=run)


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


def _record_delivery_events(run: WorkflowRunRecord, output: str) -> None:
    rows = db.fetch_all(
        """
        SELECT * FROM workflow_deliveries
        WHERE workspace_id = ? AND workflow_agent_id = ? AND enabled = 1
        ORDER BY created_at ASC
        """,
        (run.workspace_id, run.workflow_agent_id),
    )
    deliveries = [_delivery_from_row(row) for row in rows]
    if not deliveries:
        _record_run_event(
            run,
            "delivery_saved",
            "Workflow output was saved to the run.",
            {"delivery_type": "save_only", "outputPreview": output[:500]},
        )
        return

    for delivery in deliveries:
        metadata = {
            "channel": delivery.channel,
            "delivery_id": delivery.id,
            "delivery_type": delivery.delivery_type,
            "destination": delivery.destination,
            "name": delivery.name,
            "outputPreview": output[:500],
        }
        if delivery.delivery_type == "composio_action":
            metadata["action"] = delivery.config.get("action")
            metadata["appSlug"] = delivery.config.get("appSlug") or delivery.config.get("app_slug") or delivery.channel
            metadata["payloadTemplate"] = delivery.config.get("payloadTemplate") or delivery.config.get("payload_template")
        if delivery.require_approval or delivery.delivery_type == "approval_first":
            _record_run_event(
                run,
                "delivery_waiting_for_approval",
                "Workflow delivery is waiting for approval.",
                metadata,
            )
            continue
        if delivery.delivery_type == "save_only":
            _record_run_event(run, "delivery_saved", "Workflow output was saved to the run.", metadata)
            continue
        _record_run_event(
            run,
            "delivery_queued",
            "Workflow delivery was queued for the configured destination.",
            metadata,
        )


def _build_instructions(
    agent: WorkflowAgentRecord,
    knowledge_context: list[dict[str, Any]] | None = None,
    custom_tools: list[WorkflowCustomToolRecord] | None = None,
) -> str:
    skill_lines = [f"- {name}" for name in agent.skills]
    context_lines = [
        f"- {item['knowledge_base_name']} / {item['document_title']} chunk {item['chunk_index']}: {item['content']}"
        for item in knowledge_context or []
    ]
    custom_tool_specs = [_custom_tool_public_spec(tool) for tool in custom_tools or []]
    custom_tool_lines = _json_dumps(custom_tool_specs) if custom_tool_specs else "none"
    parts = [
        f"You are the Verxio workflow agent named {agent.name}.",
        f"Role: {agent.role or 'Complete the assigned workflow run.'}",
        agent.instructions or "Complete the task using the provided event/input payload.",
        "Respect the per-agent setup below.",
        "Selected skills:\n" + ("\n".join(skill_lines) if skill_lines else "none"),
        f"Brain model selected for this workflow agent: {agent.model_id or 'workspace default'}",
        f"Knowledge sources enabled: {', '.join(agent.knowledge) or 'none'}",
        "Retrieved knowledge context:\n" + ("\n".join(context_lines) if context_lines else "none"),
        f"Allowed tools: {', '.join(agent.tools) or 'default workspace tools'}",
        "Selected custom API tools:\n" + custom_tool_lines,
        (
            "To use a selected custom API tool, return only JSON in this shape: "
            '{"custom_tool_calls":[{"tool":"custom:<id>","arguments":{...}}]}. '
            "Verxio will execute the call without exposing secrets, then send results back for your final answer."
        ),
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
    if agent.model_id:
        _record_run_event(run, "model_selected", "Selected workflow agent brain model.", {"model_id": agent.model_id})
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
    custom_tools = _selected_custom_tools(workspace, agent)
    instructions = _build_instructions(agent, knowledge_context, custom_tools)
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
            instructions=instructions,
        )
        custom_tool_results = await _execute_requested_custom_tools(workspace, run, agent, output)
        if custom_tool_results:
            output = await run_agent_via_dashboard(
                workspace,
                profile,
                _json_dumps(
                    {
                        "trigger_type": trigger_type,
                        "trigger_id": trigger_id,
                        "input": payload.input,
                        "knowledge_context": knowledge_context,
                        "custom_tool_results": custom_tool_results,
                    }
                ),
                instructions=(
                    instructions
                    + "\n\nCustom tool results are now available in the input payload. "
                    "Use them to produce the final answer. Do not request the same custom tool again unless another call is necessary."
                ),
            )
    except Exception as exc:
        _set_run_status(run.id, "failed", error=str(exc), completed=True)
        return _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})
    _set_run_status(run.id, "completed", output=output, completed=True)
    completed_run = _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})
    _record_delivery_events(completed_run, output)
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
        config = _json_loads(row.get("config_json"), {})
        if trigger_type == "app_event":
            expected_app = str(config.get("appSlug") or config.get("app_slug") or "").strip().lower()
            actual_app = str(payload.get("appSlug") or payload.get("app_slug") or payload.get("app") or "").strip().lower()
            if expected_app and actual_app and expected_app != actual_app:
                continue
            if expected_app and not actual_app:
                continue
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


def _string_matches_filter(actual: str, expected: Any) -> bool:
    if expected is None or str(expected).strip() == "":
        return True
    if isinstance(expected, list):
        return any(_string_matches_filter(actual, item) for item in expected)
    return actual.strip().lower() == str(expected).strip().lower()


def _trigger_accepts_messaging_event(config: dict[str, Any], payload: WorkflowMessagingTriggerRequest) -> bool:
    if not _string_matches_filter(payload.channel, config.get("channel") or config.get("channels")):
        return False
    if not _string_matches_filter(payload.sender_id, config.get("senderId") or config.get("sender_id")):
        return False
    if not _string_matches_filter(payload.thread_id, config.get("threadId") or config.get("thread_id")):
        return False
    if not _string_matches_filter(payload.conversation_id, config.get("conversationId") or config.get("conversation_id")):
        return False
    keyword = str(config.get("keyword") or "").strip().lower()
    if keyword and keyword not in payload.message.lower():
        return False
    keywords = config.get("keywords")
    if isinstance(keywords, list) and keywords:
        lowered = payload.message.lower()
        return any(str(item).strip().lower() in lowered for item in keywords if str(item).strip())
    return True


async def run_messaging_gateway_triggers(
    workspace: Workspace,
    profile: AgentProfile,
    payload: WorkflowMessagingTriggerRequest,
) -> WorkflowTriggerRunsResponse:
    rows = db.fetch_all(
        """
        SELECT t.*
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE t.workspace_id = ?
            AND a.runtime_agent_id = ?
            AND t.trigger_type = 'chat'
            AND t.enabled = 1
            AND (? = '' OR t.event_name = ?)
        ORDER BY t.updated_at ASC
        """,
        (workspace.id, profile.id, payload.event_name.strip(), payload.event_name.strip()),
    )
    event_payload = {
        **payload.input,
        "channel": payload.channel,
        "conversation_id": payload.conversation_id,
        "message": payload.message,
        "message_id": payload.message_id,
        "reply_to_source": {
            "channel": payload.channel,
            "conversation_id": payload.conversation_id,
            "sender_id": payload.sender_id,
            "thread_id": payload.thread_id,
        },
        "sender_id": payload.sender_id,
        "sender_name": payload.sender_name,
        "thread_id": payload.thread_id,
    }
    runs: list[WorkflowRunRecord] = []
    for row in rows:
        config = _json_loads(row.get("config_json"), {})
        if not isinstance(config, dict) or not _trigger_accepts_messaging_event(config, payload):
            continue
        runs.append(
            await run_agent(
                workspace,
                profile,
                str(row["workflow_agent_id"]),
                WorkflowRunCreateRequest(input={"event": row["event_name"], "payload": event_payload}),
                trigger_id=str(row["id"]),
                trigger_type="chat",
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
