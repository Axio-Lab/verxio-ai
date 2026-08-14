from __future__ import annotations

import asyncio
import base64
import binascii
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
from croniter import croniter
from fastapi import HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.knowledge_bases import retrieve_context
from app.models import (
    AgentProfile,
    WorkflowAgentCreateRequest,
    WorkflowAgentFromTemplateRequest,
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
    create_composio_trigger_instance,
    delete_composio_trigger_instance,
    ensure_composio_webhook_subscription,
    execute_composio_tool,
    get_composio_catalog_error,
    is_composio_configured,
    list_composio_accounts,
    list_composio_apps,
    set_composio_trigger_instance_enabled,
)
from app.runtime import HermesRuntimeAdapter
from app.runtime_dashboard import list_toolsets_via_dashboard, run_agent_via_dashboard, send_message_via_dashboard

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


def _is_lead_workflow(text: str) -> bool:
    return bool(
        re.search(
            r"\b(?:lead|leads|prospect|prospects)\b",
            text,
        )
        and re.search(
            r"\b(?:sales|research|qualif(?:y|ication)|scor(?:e|ing)|prospect|crm|form submission|strategy call)\b",
            text,
        )
    )


def _requested_agent_kind(prompt: str) -> str:
    normalized = " ".join(prompt.split())
    match = re.search(
        r"\b(?:create|build|make|set up)\s+(?:an?\s+)?(?P<kind>[a-z0-9][a-z0-9 -]{0,80}?)\s+agent\b",
        normalized,
        flags=re.IGNORECASE,
    )
    if not match:
        return ""
    kind = re.sub(r"\s+", " ", match.group("kind")).strip(" -")
    return kind


def _workflow_role(prompt: str, *, existing: WorkflowAgentRecord | None = None) -> str:
    if existing and existing.role:
        return existing.role

    text = prompt.lower()
    if "payment" in text:
        return "Notify customers and teams after successful payment events"
    if _is_lead_workflow(text):
        return "Research, qualify, and prepare next actions for leads"
    if "support" in text or "customer" in text:
        return "Answer customer questions and escalate when needed"
    if "cosmetic" in text or "youcam" in text:
        return "Recommend cosmetic products with approved tools and knowledge"
    if _contains_any(text, ["micro-manager", "micromanager", "follow up with team", "follow-up with team"]):
        return "Follow up on team tasks, identify bottlenecks, and escalate them to the team lead"

    requested_kind = _requested_agent_kind(prompt)
    if requested_kind:
        return f"Operate as a {requested_kind} agent using configured capabilities"
    return "Complete the described workflow with configured capabilities"


def _workflow_description(prompt: str, role: str, *, existing: WorkflowAgentRecord | None = None) -> str:
    if existing and existing.description:
        return existing.description

    text = prompt.lower()
    if _contains_any(text, ["micro-manager", "micromanager", "follow up with team", "follow-up with team"]):
        return "Follows up with team members, tracks task bottlenecks, and alerts the team lead when work is blocked."

    goal = re.split(r"\n\s*use only configured\b", prompt.strip(), maxsplit=1, flags=re.IGNORECASE)[0]
    goal = " ".join(goal.split()).strip()
    goal = re.sub(
        r"^(?:please\s+)?(?:create|build|make|set up)\s+(?:an?\s+)?",
        "",
        goal,
        flags=re.IGNORECASE,
    )
    if goal:
        return goal[0].upper() + goal[1:1000]
    return role[:1000]


def _title_from_prompt(prompt: str) -> str:
    prompt = " ".join(prompt.split())
    lower = prompt.lower()
    if "payment" in lower:
        return "Payment Delivery Agent"
    if _is_lead_workflow(lower):
        return "Lead Research Agent"
    if "support" in lower or "customer" in lower:
        return "Customer Support Agent"
    if "cosmetic" in lower or "makeup" in lower or "beauty" in lower:
        return "AI Cosmetic Consultant"
    requested_kind = _requested_agent_kind(prompt)
    if requested_kind:
        title = requested_kind.title()
        return title[:180] if title.lower().endswith("agent") else f"{title} Agent"[:180]
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
    payload["tags"] = _string_list(_json_loads(payload.pop("tags_json", "[]"), []))
    funnel_rules = _json_loads(payload.pop("funnel_rules_json", "{}"), {})
    if isinstance(funnel_rules, list):
        funnel_rules = {"rules": funnel_rules}
    payload["funnel_rules"] = funnel_rules if isinstance(funnel_rules, dict) else {"rules": []}
    payload["origin"] = str(payload.get("origin") or "user")
    payload["fallback_email"] = str(payload.get("fallback_email") or "")
    payload["campaign_context"] = str(payload.get("campaign_context") or "")
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
        if schedule and not croniter.is_valid(schedule):
            raise HTTPException(status_code=422, detail="Schedule trigger cron expression is invalid.")
    if trigger_type == "app_event":
        app_slug = str(config.get("appSlug") or config.get("app_slug") or "").strip()
        connected_account_id = str(
            config.get("connectedAccountId") or config.get("connected_account_id") or ""
        ).strip()
        trigger_slug = str(config.get("triggerSlug") or config.get("trigger_slug") or "").strip()
        if not app_slug or not connected_account_id or not trigger_slug:
            raise HTTPException(
                status_code=422,
                detail="Connected app triggers require appSlug, connectedAccountId, and triggerSlug.",
            )


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
    if delivery_type == "webhook_callback":
        url = str(config.get("url") or destination or "").strip()
        if not (url.startswith("https://") or url.startswith("http://")):
            raise HTTPException(status_code=422, detail="Webhook callback deliveries require an http(s) URL.")
    if delivery_type == "composio_action":
        action = str(config.get("action") or "").strip()
        app_slug = str(config.get("appSlug") or config.get("app_slug") or channel or "").strip()
        account_id = str(config.get("connectedAccountId") or config.get("connected_account_id") or "").strip()
        if not app_slug or not action or not account_id:
            raise HTTPException(
                status_code=422,
                detail="Connected app deliveries require appSlug, connectedAccountId, and action.",
            )
        arguments = config.get("arguments", {})
        if not isinstance(arguments, dict):
            raise HTTPException(status_code=422, detail="Connected app delivery arguments must be an object.")
        if action == "GMAIL_SEND_EMAIL" and not destination.strip():
            raise HTTPException(status_code=422, detail="Gmail deliveries require a recipient email address.")


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
        "google form": "googleforms",
        "google forms": "googleforms",
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

    if _is_lead_workflow(text):
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

    role = _workflow_role(prompt, existing=existing)
    description = _workflow_description(prompt, role, existing=existing)

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
            description=description[:1000],
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
            integrations_json, approval_policy, tags_json, origin, funnel_rules_json,
            fallback_email, campaign_context, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]', 'user', ?, ?, ?, ?, ?)
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
            _json_dumps(_json_object(payload.funnel_rules) or {"rules": []}),
            payload.fallback_email.strip(),
            payload.campaign_context.strip(),
            created_at,
            created_at,
        ),
    )
    return get_agent(workspace, profile, agent_id)


def create_agent_from_template(
    workspace: Workspace,
    profile: AgentProfile,
    payload: WorkflowAgentFromTemplateRequest,
) -> WorkflowAgentRecord:
    from app.default_workflow_agents import create_from_template

    return create_from_template(workspace, profile, payload.template, name=payload.name)


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
    funnel_rules = data.get("funnel_rules") if isinstance(data.get("funnel_rules"), dict) else current.funnel_rules
    db.execute(
        """
        UPDATE workflow_agents
        SET name = ?, role = ?, description = ?, instructions = ?, model_id = ?, enabled = ?,
            skills_json = ?, knowledge_json = ?, tools_json = ?, integrations_json = ?,
            approval_policy = ?, funnel_rules_json = ?, fallback_email = ?, campaign_context = ?,
            updated_at = ?
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
            _json_dumps(funnel_rules or {"rules": []}),
            str(data.get("fallback_email") or "").strip(),
            str(data.get("campaign_context") or "").strip(),
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


def delete_setup_draft(workspace: Workspace, profile: AgentProfile, draft_id: str) -> dict[str, bool]:
    row = db.fetch_one(
        """
        SELECT id FROM workflow_agent_setup_drafts
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (draft_id, workspace.id, profile.id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Agent setup draft was not found.")
    db.execute(
        """
        DELETE FROM workflow_agent_setup_approvals
        WHERE setup_draft_id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (draft_id, workspace.id, profile.id),
    )
    db.execute(
        """
        DELETE FROM workflow_agent_setup_drafts
        WHERE id = ? AND workspace_id = ? AND runtime_agent_id = ?
        """,
        (draft_id, workspace.id, profile.id),
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


def _next_schedule_at(config: dict[str, Any], *, after: datetime | None = None) -> str | None:
    after = after or datetime.now(timezone.utc)
    schedule = str(config.get("schedule") or config.get("cron") or "").strip()
    if schedule:
        next_run = croniter(schedule, after).get_next(datetime)
        if next_run.tzinfo is None:
            next_run = next_run.replace(tzinfo=timezone.utc)
        return next_run.astimezone(timezone.utc).isoformat()

    interval_seconds = int(config.get("intervalSeconds") or config.get("interval_seconds") or 0)
    if interval_seconds <= 0:
        interval_seconds = int(config.get("everyMinutes") or config.get("every_minutes") or 0) * 60
    if interval_seconds <= 0:
        return None
    return (after + timedelta(seconds=interval_seconds)).isoformat()


def create_trigger(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: WorkflowTriggerCreateRequest,
    request: Request | None = None,
) -> WorkflowTriggerRecord:
    get_agent(workspace, profile, agent_id)
    _validate_trigger_payload(payload.trigger_type, payload.event_name, payload.config)
    config = dict(payload.config)
    composio_trigger_id = ""
    if payload.trigger_type == "app_event":
        account_id = str(config.get("connectedAccountId") or config.get("connected_account_id") or "").strip()
        app_slug = str(config.get("appSlug") or config.get("app_slug") or "").strip().lower()
        account = next(
            (
                item
                for item in list_composio_accounts(workspace.tenant_id)
                if item.id == account_id
                and item.appSlug.strip().lower() == app_slug
                and item.status.strip().upper() == "ACTIVE"
            ),
            None,
        )
        if account is None:
            raise HTTPException(status_code=422, detail="Select an active connected account owned by this workspace.")
        ensure_composio_webhook_subscription(f"{_base_url(request)}/api/composio/webhooks")
        trigger_slug = str(config.get("triggerSlug") or config.get("trigger_slug") or "").strip()
        trigger_config = config.get("triggerConfig") or config.get("trigger_config") or {}
        if not isinstance(trigger_config, dict):
            raise HTTPException(status_code=422, detail="Connected app trigger configuration must be an object.")
        composio_trigger_id = create_composio_trigger_instance(
            trigger_slug,
            connected_account_id=account_id,
            trigger_config=trigger_config,
            user_id=workspace.tenant_id,
        )
        config["composioTriggerId"] = composio_trigger_id

    created_at = now_iso()
    trigger_id = new_id("workflow_trigger")
    next_run_at = (
        _next_schedule_at(config)
        if payload.trigger_type == "schedule" and payload.enabled
        else None
    )
    try:
        db.execute(
            """
            INSERT INTO workflow_triggers (
                id, tenant_id, workspace_id, workflow_agent_id, trigger_type, event_name,
                name, enabled, secret, config_json, next_run_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                _json_dumps(config),
                next_run_at,
                created_at,
                created_at,
            ),
        )
    except Exception:
        if composio_trigger_id:
            delete_composio_trigger_instance(composio_trigger_id)
        raise
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
    if current.trigger_type == "app_event" and payload.config is not None and payload.config != current.config:
        raise HTTPException(
            status_code=422,
            detail="Connected app bindings cannot be edited in place. Delete and recreate the trigger.",
        )
    secret = _secret() if payload.rotate_secret and current.trigger_type == "webhook" else current.secret
    config = data.get("config") if isinstance(data.get("config"), dict) else {}
    if current.trigger_type == "app_event" and payload.enabled is not None:
        composio_trigger_id = str(config.get("composioTriggerId") or "")
        should_enable = bool(data.get("enabled"))
        if not should_enable:
            other_rows = db.fetch_all(
                """
                SELECT config_json
                FROM workflow_triggers
                WHERE trigger_type = 'app_event' AND enabled = 1 AND id != ?
                """,
                (trigger_id,),
            )
            should_enable = any(
                str(_json_loads(row.get("config_json"), {}).get("composioTriggerId") or "")
                == composio_trigger_id
                for row in other_rows
            )
        set_composio_trigger_instance_enabled(composio_trigger_id, should_enable)
    next_run_at = (
        _next_schedule_at(config)
        if current.trigger_type == "schedule" and data.get("enabled")
        else None
    )
    db.execute(
        """
        UPDATE workflow_triggers
        SET event_name = ?, name = ?, enabled = ?, secret = ?, config_json = ?,
            next_run_at = ?, claim_token = '', claimed_at = NULL, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND workflow_agent_id = ?
        """,
        (
            str(data.get("event_name") or "").strip(),
            str(data.get("name") or "").strip(),
            1 if data.get("enabled") else 0,
            secret,
            _json_dumps(config),
            next_run_at,
            now_iso(),
            trigger_id,
            workspace.id,
            agent_id,
        ),
    )
    return get_trigger(workspace, profile, agent_id, trigger_id, request)


def delete_trigger(workspace: Workspace, profile: AgentProfile, agent_id: str, trigger_id: str) -> dict[str, bool]:
    trigger = get_trigger(workspace, profile, agent_id, trigger_id)
    if trigger.trigger_type == "app_event":
        composio_trigger_id = str(trigger.config.get("composioTriggerId") or "")
        other_rows = db.fetch_all(
            "SELECT config_json FROM workflow_triggers WHERE trigger_type = 'app_event' AND id != ?",
            (trigger_id,),
        )
        still_referenced = any(
            str(_json_loads(row.get("config_json"), {}).get("composioTriggerId") or "")
            == composio_trigger_id
            for row in other_rows
        )
        if not still_referenced:
            delete_composio_trigger_instance(composio_trigger_id)
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
                    "conversation_id": payload.visitor_id.strip() or f"embed:{public_token}",
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


def _delivery_context_value(context: dict[str, Any], path: str) -> Any:
    def resolve(root: Any) -> Any:
        value = root
        for part in path.split("."):
            if not isinstance(value, dict) or part not in value:
                return None
            value = value[part]
        return value

    value = resolve(context)
    return resolve(context.get("input")) if value is None else value


def _render_delivery_text(template: str, context: dict[str, Any]) -> str:
    source = template.strip() or "{{agent.output}}"

    def replace(match: re.Match[str]) -> str:
        value = _delivery_context_value(context, match.group(1).strip())
        if value is None:
            return match.group(0)
        if isinstance(value, (dict, list)):
            return _json_dumps(value)
        return str(value)

    return re.sub(r"\{\{\s*([^{}]+?)\s*\}\}", replace, source).strip()


def _render_delivery_value(value: Any, context: dict[str, Any]) -> Any:
    if isinstance(value, str):
        return _render_delivery_text(value, context)
    if isinstance(value, list):
        return [_render_delivery_value(item, context) for item in value]
    if isinstance(value, dict):
        return {key: _render_delivery_value(item, context) for key, item in value.items()}
    return value


async def _execute_delivery(
    workspace: Workspace,
    profile: AgentProfile,
    run: WorkflowRunRecord,
    delivery: WorkflowDeliveryRecord,
    output: str,
    run_input: dict[str, Any],
) -> dict[str, Any]:
    context = {
        "agent": {"output": output},
        "input": run_input,
        "output": output,
        "run": {"id": run.id, "trigger_type": run.trigger_type},
    }
    content = _render_delivery_text(delivery.template, context)
    if delivery.delivery_type in {"send_message", "reply_to_source"}:
        channel = delivery.channel
        destination = delivery.destination
        connection_id = str(
            delivery.config.get("connectionId") or delivery.config.get("connection_id") or "default"
        )
        if delivery.delivery_type == "reply_to_source":
            payload = run_input.get("payload") if isinstance(run_input.get("payload"), dict) else run_input
            reply = payload.get("reply_to_source") if isinstance(payload, dict) else None
            if not isinstance(reply, dict):
                raise HTTPException(status_code=422, detail="This run has no messaging source to reply to.")
            channel = str(reply.get("channel") or channel).strip()
            connection_id = str(reply.get("connection_id") or connection_id).strip() or "default"
            destination = str(reply.get("conversation_id") or reply.get("sender_id") or "").strip()
            thread_id = str(reply.get("thread_id") or "").strip()
            if destination and thread_id:
                destination = f"{destination}:{thread_id}"
        if not channel or not destination:
            raise HTTPException(status_code=422, detail="Messaging delivery has no channel or destination.")
        result = await send_message_via_dashboard(
            workspace,
            profile,
            platform=channel,
            connection_id=connection_id,
            destination=destination,
            message=content,
        )
        return {
            "provider": "hermes",
            "message_id": result.get("message_id"),
            "success": bool(result.get("success", True)),
        }

    if delivery.delivery_type == "webhook_callback":
        url = str(delivery.config.get("url") or delivery.destination).strip()
        headers = delivery.config.get("headers")
        safe_headers = (
            {str(key): str(value) for key, value in headers.items()}
            if isinstance(headers, dict)
            else {}
        )
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                url,
                json={"output": content, "run": run.model_dump(mode="json"), "input": run_input},
                headers=safe_headers,
            )
            response.raise_for_status()
        return {"provider": "webhook", "status_code": response.status_code}

    if delivery.delivery_type == "composio_action":
        config = delivery.config
        action = str(config.get("action") or "").strip()
        account_id = str(config.get("connectedAccountId") or config.get("connected_account_id") or "").strip()
        arguments = _render_delivery_value(config.get("arguments") or {}, context)
        if not isinstance(arguments, dict):
            raise HTTPException(status_code=422, detail="Connected app delivery arguments must be an object.")
        if action == "GMAIL_SEND_EMAIL":
            arguments.setdefault("recipient_email", delivery.destination)
            arguments.setdefault("subject", delivery.name or "Verxio agent report")
            arguments.setdefault("body", content)
        result = await asyncio.to_thread(
            execute_composio_tool,
            action,
            connected_account_id=account_id,
            user_id=workspace.tenant_id,
            arguments=arguments,
        )
        return {
            "provider": "composio",
            "successful": bool(result.get("successful", True)),
        }

    raise HTTPException(status_code=422, detail=f"Unsupported delivery type: {delivery.delivery_type}")


async def _record_delivery_events(
    workspace: Workspace,
    profile: AgentProfile,
    run: WorkflowRunRecord,
    output: str,
    run_input: dict[str, Any],
) -> None:
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
        try:
            result = await _execute_delivery(workspace, profile, run, delivery, output, run_input)
        except Exception as exc:
            metadata["error"] = str(exc)
            _record_run_event(run, "delivery_failed", "Workflow delivery failed.", metadata)
            continue
        metadata["result"] = result
        _record_run_event(run, "delivery_sent", "Workflow delivery was sent.", metadata)


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
    instructions = _render_agent_instructions(agent)
    parts = [
        f"You are the Verxio workflow agent named {agent.name}.",
        f"Role: {agent.role or 'Complete the assigned workflow run.'}",
        instructions or "Complete the task using the provided event/input payload.",
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


RATING_THANK_YOU = (
    "Thank you for your feedback. I really appreciate your rating. If you need anything else, just let me know."
)
SUGGEST_RATING_MARKER = "[SUGGEST_RATING]"


def _agent_has_tag(agent: WorkflowAgentRecord, tag: str) -> bool:
    return tag in (agent.tags or [])


def _run_payload(input_payload: dict[str, Any]) -> dict[str, Any]:
    payload = input_payload.get("payload") if isinstance(input_payload.get("payload"), dict) else input_payload
    return payload if isinstance(payload, dict) else {}


def _message_from_run_input(input_payload: dict[str, Any]) -> str:
    payload = _run_payload(input_payload)
    for key in ("message", "question", "text"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    return str(input_payload.get("message") or "").strip()


def _conversation_id_from_input(input_payload: dict[str, Any], trigger_type: str) -> str:
    payload = _run_payload(input_payload)
    for key in ("conversation_id", "visitor_id", "sender_id"):
        value = str(payload.get(key) or "").strip()
        if value:
            return value
    token = str(payload.get("public_token") or "").strip()
    if token:
        return f"embed:{token}"
    if trigger_type:
        return ""
    return ""


def _render_agent_instructions(agent: WorkflowAgentRecord) -> str:
    text = agent.instructions or ""
    email = agent.fallback_email.strip()
    if email:
        text = text.replace("{fallback_email}", email)
    else:
        text = text.replace(
            "Please email us at {fallback_email} and our team will get back to you.",
            "please contact support via email and a human agent will respond.",
        )
        text = text.replace(
            "You can reach our team directly at {fallback_email} and they'll get back to you.",
            "please reach out to the team directly and they'll get back to you.",
        )
        text = text.replace("{fallback_email}", "the team")
    campaign = agent.campaign_context.strip()
    if "{campaign_context}" in text:
        text = text.replace("{campaign_context}", campaign or "No campaign context has been added yet.")
    elif campaign:
        text = f"{text.rstrip()}\n\n## Campaign / Post Context\n{campaign}\n"
    return text


def _get_or_create_agent_session(workspace: Workspace, agent_id: str, conversation_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        """
        SELECT * FROM workflow_agent_sessions
        WHERE workflow_agent_id = ? AND conversation_id = ?
        """,
        (agent_id, conversation_id),
    )
    if row:
        return row
    now = now_iso()
    session_id = new_id("workflow_session")
    db.execute(
        """
        INSERT INTO workflow_agent_sessions (
            id, tenant_id, workspace_id, workflow_agent_id, conversation_id,
            suggest_rating, rating, metadata_json, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, 0, NULL, '{}', ?, ?)
        """,
        (session_id, workspace.tenant_id, workspace.id, agent_id, conversation_id, now, now),
    )
    return db.fetch_one("SELECT * FROM workflow_agent_sessions WHERE id = ?", (session_id,)) or {}


def _maybe_handle_rating(workspace: Workspace, agent_id: str, conversation_id: str, message: str) -> str | None:
    if not conversation_id or not message.strip():
        return None
    session = _get_or_create_agent_session(workspace, agent_id, conversation_id)
    trimmed = message.strip()
    first = trimmed[:1]
    looks_like_rating = bool(session.get("suggest_rating")) and first.isdigit() and 1 <= int(first) <= 5
    if looks_like_rating:
        db.execute(
            """
            UPDATE workflow_agent_sessions
            SET rating = ?, suggest_rating = 0, updated_at = ?
            WHERE id = ?
            """,
            (int(first), now_iso(), session["id"]),
        )
        return RATING_THANK_YOU
    if session.get("rating") is not None:
        from app.sdr_funnel import is_closing_message

        if is_closing_message(trimmed):
            return ""
    return None


def _capture_rating_suggestion(workspace: Workspace, agent_id: str, conversation_id: str, output: str) -> str:
    if SUGGEST_RATING_MARKER not in output:
        return output
    cleaned = re.sub(r"\n?\[SUGGEST_RATING\]\s*$", "", output.strip(), flags=re.IGNORECASE).replace(SUGGEST_RATING_MARKER, "").strip()
    if conversation_id:
        session = _get_or_create_agent_session(workspace, agent_id, conversation_id)
        db.execute(
            """
            UPDATE workflow_agent_sessions
            SET suggest_rating = 1, updated_at = ?
            WHERE id = ?
            """,
            (now_iso(), session["id"]),
        )
    return cleaned


async def _complete_run_output(
    workspace: Workspace,
    profile: AgentProfile,
    run: WorkflowRunRecord,
    output: str,
    run_input: dict[str, Any],
    *,
    event_type: str,
    message: str,
    metadata: dict[str, Any] | None = None,
) -> WorkflowRunRecord:
    _record_run_event(run, event_type, message, metadata or {})
    _set_run_status(run.id, "completed", output=output, completed=True)
    completed = _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})
    if output.strip():
        await _record_delivery_events(workspace, profile, completed, output, run_input)
    else:
        _record_run_event(completed, "delivery_saved", "Workflow output was saved to the run.", {"delivery_type": "save_only"})
    return _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})


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
    conversation_id = _conversation_id_from_input(payload.input, trigger_type)
    message = _message_from_run_input(payload.input)
    rating_reply = _maybe_handle_rating(workspace, agent.id, conversation_id, message)
    if rating_reply is not None:
        return await _complete_run_output(
            workspace,
            profile,
            run,
            rating_reply,
            payload.input,
            event_type="rating_recorded" if rating_reply else "rating_closed",
            message="Stored a customer rating without calling the model." if rating_reply else "Ignored a closing message after a rating.",
        )
    if _agent_has_tag(agent, "sdr"):
        from app.sdr_funnel import maybe_handle_sdr_message

        sdr_reply = await maybe_handle_sdr_message(
            workspace,
            profile,
            agent,
            message=message,
            conversation_id=conversation_id,
            trigger_type=trigger_type,
            run_input=payload.input,
        )
        if sdr_reply is not None:
            return await _complete_run_output(
                workspace,
                profile,
                run,
                sdr_reply,
                payload.input,
                event_type="sdr_funnel",
                message="SDR funnel handled this message.",
            )
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
    output = _capture_rating_suggestion(workspace, agent.id, conversation_id, output)
    _set_run_status(run.id, "completed", output=output, completed=True)
    completed_run = _run_from_row(db.fetch_one("SELECT * FROM workflow_runs WHERE id = ?", (run.id,)) or {})
    await _record_delivery_events(workspace, profile, completed_run, output, payload.input)
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


async def run_composio_trigger_event(payload: dict[str, Any]) -> WorkflowTriggerRunsResponse:
    if str(payload.get("type") or "") != "composio.trigger.message":
        return WorkflowTriggerRunsResponse(runs=[])
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    external_trigger_id = str(metadata.get("trigger_id") or "").strip()
    connected_account_id = str(metadata.get("connected_account_id") or "").strip()
    trigger_slug = str(metadata.get("trigger_slug") or "").strip()
    if not external_trigger_id or not connected_account_id or not trigger_slug:
        raise HTTPException(status_code=400, detail="Composio trigger metadata is incomplete.")

    rows = db.fetch_all(
        """
        SELECT t.*, a.runtime_agent_id
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE t.trigger_type = 'app_event' AND t.enabled = 1
        ORDER BY t.updated_at ASC
        """
    )
    runs: list[WorkflowRunRecord] = []
    for row in rows:
        config = _json_loads(row.get("config_json"), {})
        if str(config.get("composioTriggerId") or "") != external_trigger_id:
            continue
        if str(config.get("connectedAccountId") or config.get("connected_account_id") or "") != connected_account_id:
            continue
        workspace, profile = _trigger_owner_context(row)
        runs.append(
            await run_agent(
                workspace,
                profile,
                str(row["workflow_agent_id"]),
                WorkflowRunCreateRequest(
                    input={
                        "event": trigger_slug,
                        "payload": payload.get("data") if isinstance(payload.get("data"), dict) else {},
                        "source": {"composio": metadata},
                    }
                ),
                trigger_id=str(row["id"]),
                trigger_type="app_event",
            )
        )
    return WorkflowTriggerRunsResponse(runs=runs)


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
    if bool(config.get("requireConnection") or config.get("require_connection")):
        expected_connection = str(config.get("connectionId") or config.get("connection_id") or "").strip()
        if not expected_connection:
            return False
    if not _string_matches_filter(payload.channel, config.get("channel") or config.get("channels")):
        return False
    if not _string_matches_filter(
        payload.connection_id,
        config.get("connectionId") or config.get("connection_id"),
    ):
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
        "connection_id": payload.connection_id,
        "conversation_id": payload.conversation_id,
        "message": payload.message,
        "message_id": payload.message_id,
        "reply_to_source": {
            "channel": payload.channel,
            "connection_id": payload.connection_id,
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


def _trigger_owner_context(row: dict[str, Any]) -> tuple[Workspace, AgentProfile]:
    workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (row["workspace_id"],))
    runtime_agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (row["runtime_agent_id"],))
    if not workspace_row or not runtime_agent_row:
        raise HTTPException(status_code=404, detail="Workflow trigger owner not found.")
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
    return workspace, profile


async def _run_claimed_schedule_trigger(row: dict[str, Any], claim_token: str) -> WorkflowRunRecord:
    workspace, profile = _trigger_owner_context(row)
    config = _json_loads(row.get("config_json"), {})
    scheduled_at = now_iso()
    try:
        return await run_agent(
            workspace,
            profile,
            str(row["workflow_agent_id"]),
            WorkflowRunCreateRequest(
                input={
                    "event": row["event_name"],
                    "payload": {"scheduledAt": scheduled_at, "config": config},
                }
            ),
            trigger_id=str(row["id"]),
            trigger_type="schedule",
        )
    finally:
        db.execute(
            """
            UPDATE workflow_triggers
            SET last_run_at = ?, claim_token = '', claimed_at = NULL, updated_at = ?
            WHERE id = ? AND claim_token = ?
            """,
            (scheduled_at, now_iso(), row["id"], claim_token),
        )


async def tick_due_schedule_triggers(
    workspace: Workspace | None = None,
    profile: AgentProfile | None = None,
) -> WorkflowTriggerRunsResponse:
    now = datetime.now(timezone.utc)
    where = [
        "t.trigger_type = 'schedule'",
        "t.enabled = 1",
        "(t.next_run_at IS NULL OR t.next_run_at <= ?)",
    ]
    params: list[Any] = [now.isoformat()]
    if workspace is not None:
        where.append("t.workspace_id = ?")
        params.append(workspace.id)
    if profile is not None:
        where.append("a.runtime_agent_id = ?")
        params.append(profile.id)
    rows = db.fetch_all(
        f"""
        SELECT t.*, a.runtime_agent_id
        FROM workflow_triggers t
        JOIN workflow_agents a ON a.id = t.workflow_agent_id
        WHERE {" AND ".join(where)}
        ORDER BY t.updated_at ASC
        """,
        params,
    )
    runs: list[WorkflowRunRecord] = []
    for row in rows:
        config = _json_loads(row.get("config_json"), {})
        next_run_at = _next_schedule_at(config, after=now)
        if not next_run_at:
            continue
        claim_token = secrets.token_urlsafe(18)
        stale_before = (now - timedelta(minutes=10)).isoformat()
        db.execute(
            """
            UPDATE workflow_triggers
            SET claim_token = ?, claimed_at = ?, next_run_at = ?, updated_at = ?
            WHERE id = ? AND enabled = 1
                AND (next_run_at IS NULL OR next_run_at <= ?)
                AND (claim_token = '' OR claimed_at IS NULL OR claimed_at <= ?)
            """,
            (
                claim_token,
                now.isoformat(),
                next_run_at,
                now_iso(),
                row["id"],
                now.isoformat(),
                stale_before,
            ),
        )
        claimed = db.fetch_one(
            "SELECT id FROM workflow_triggers WHERE id = ? AND claim_token = ?",
            (row["id"], claim_token),
        )
        if not claimed:
            continue
        runs.append(await _run_claimed_schedule_trigger(row, claim_token))
    from app.sdr_funnel import tick_due_sdr_follow_ups

    await tick_due_sdr_follow_ups()
    return WorkflowTriggerRunsResponse(runs=runs)


def list_agent_sdr_contacts(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    channel: str = "",
):
    get_agent(workspace, profile, agent_id)
    from app.sdr_funnel import list_sdr_contacts

    return list_sdr_contacts(workspace, agent_id, channel)


def export_agent_sdr_contacts(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    channel: str = "",
):
    agent = get_agent(workspace, profile, agent_id)
    from app.sdr_funnel import export_sdr_contacts_vcf

    return export_sdr_contacts_vcf(workspace, agent, channel)
