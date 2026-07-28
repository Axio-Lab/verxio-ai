from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import httpx
import yaml
from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import (
    ComposioApp,
    ComposioAuthInputField,
    ComposioCompleteConnectionResponse,
    ComposioConnectedAccount,
    ComposioConnectionSetupResponse,
    ComposioInitiateResponse,
    ComposioToolBridgeStatus,
    ComposioToolPreview,
    ComposioTriggerType,
    ComposioTriggerTypesResponse,
    RuntimeInstance,
)

logger = logging.getLogger(__name__)


COMPOSIO_MCP_SERVER_NAME = "composio"
COMPOSIO_BRIDGE_STATE_FILE = "composio-tool-router-session.json"
COMPOSIO_PROMPT_START = "<!-- VERXIO_COMPOSIO_CONTEXT_START -->"
COMPOSIO_PROMPT_END = "<!-- VERXIO_COMPOSIO_CONTEXT_END -->"

COMPOSIO_APP_CATALOG = [
    ComposioApp(
        categories=["email", "sales"],
        description="Read, draft, and organize business email workflows.",
        name="Gmail",
        sampleTools=[
            ComposioToolPreview(
                description="Find relevant customer and internal emails.",
                name="Search email",
                slug="GMAIL_SEARCH_EMAILS",
            ),
            ComposioToolPreview(
                description="Draft or send follow-up messages.",
                name="Send email",
                slug="GMAIL_SEND_EMAIL",
            ),
        ],
        slug="gmail",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["spreadsheet", "reporting"],
        description="Create reports, update rows, and analyze operating data.",
        name="Google Sheets",
        sampleTools=[
            ComposioToolPreview(
                description="Read business records from a sheet.",
                name="Read rows",
                slug="GOOGLESHEETS_READ_ROWS",
            ),
            ComposioToolPreview(
                description="Update dashboards and operating trackers.",
                name="Update sheet",
                slug="GOOGLESHEETS_UPDATE_SHEET",
            ),
        ],
        slug="googlesheets",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["files", "knowledge"],
        description="Search files, summarize folders, and organize shared assets.",
        name="Google Drive",
        sampleTools=[
            ComposioToolPreview(
                description="Find documents and folders by business context.",
                name="Search files",
                slug="GOOGLEDRIVE_SEARCH_FILES",
            ),
            ComposioToolPreview(
                description="Create or organize generated artifacts.",
                name="Create file",
                slug="GOOGLEDRIVE_CREATE_FILE",
            ),
        ],
        slug="googledrive",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["calendar", "operations"],
        description="Schedule meetings, inspect calendars, and coordinate handoffs.",
        name="Google Calendar",
        sampleTools=[
            ComposioToolPreview(
                description="Create meetings and follow-up reminders.",
                name="Create event",
                slug="GOOGLECALENDAR_CREATE_EVENT",
            ),
        ],
        slug="googlecalendar",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["documents", "content"],
        description="Draft docs, update briefs, and turn notes into deliverables.",
        name="Google Docs",
        sampleTools=[
            ComposioToolPreview(
                description="Create briefs, reports, and internal docs.",
                name="Create document",
                slug="GOOGLEDOCS_CREATE_DOCUMENT",
            ),
        ],
        slug="googledocs",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["team", "messages"],
        description="Read channels, summarize decisions, and send team updates.",
        name="Slack",
        sampleTools=[
            ComposioToolPreview(
                description="Post updates to team channels.",
                name="Send message",
                slug="SLACK_SEND_MESSAGE",
            ),
            ComposioToolPreview(
                description="Search channels for decisions and context.",
                name="Search messages",
                slug="SLACK_SEARCH_MESSAGES",
            ),
        ],
        slug="slack",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["knowledge", "project"],
        description="Search pages, update databases, and maintain internal systems.",
        name="Notion",
        sampleTools=[
            ComposioToolPreview(
                description="Create operating pages and internal playbooks.",
                name="Create page",
                slug="NOTION_CREATE_PAGE",
            ),
            ComposioToolPreview(
                description="Update CRM-style tables and project databases.",
                name="Update database",
                slug="NOTION_UPDATE_DATABASE",
            ),
        ],
        slug="notion",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["database", "crm"],
        description="Build lightweight CRMs, update records, and sync field data.",
        name="Airtable",
        sampleTools=[
            ComposioToolPreview(
                description="Read rows from CRM and operations bases.",
                name="List records",
                slug="AIRTABLE_LIST_RECORDS",
            ),
            ComposioToolPreview(
                description="Create customer, sales, and support records.",
                name="Create record",
                slug="AIRTABLE_CREATE_RECORD",
            ),
        ],
        slug="airtable",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["crm", "sales"],
        description="Manage contacts, companies, deals, and follow-up workflows.",
        name="HubSpot",
        sampleTools=[
            ComposioToolPreview(
                description="Create or update customer contacts.",
                name="Manage contacts",
                slug="HUBSPOT_MANAGE_CONTACTS",
            ),
            ComposioToolPreview(
                description="Inspect and update sales pipeline deals.",
                name="Manage deals",
                slug="HUBSPOT_MANAGE_DEALS",
            ),
        ],
        slug="hubspot",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["code", "project"],
        description="Inspect issues, open pull requests, and manage repository work.",
        name="GitHub",
        sampleTools=[
            ComposioToolPreview(
                description="Create and triage engineering issues.",
                name="Create issue",
                slug="GITHUB_CREATE_ISSUE",
            ),
            ComposioToolPreview(
                description="Inspect repository files and pull requests.",
                name="Read repository",
                slug="GITHUB_READ_REPOSITORY",
            ),
        ],
        slug="github",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["project", "engineering"],
        description="Track issues, update roadmaps, and prepare delivery reports.",
        name="Linear",
        sampleTools=[
            ComposioToolPreview(
                description="Create tasks from decisions and user requests.",
                name="Create issue",
                slug="LINEAR_CREATE_ISSUE",
            ),
            ComposioToolPreview(
                description="Summarize project delivery status.",
                name="List issues",
                slug="LINEAR_LIST_ISSUES",
            ),
        ],
        slug="linear",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["project", "support"],
        description="Create tickets, triage work, and summarize delivery status.",
        name="Jira",
        sampleTools=[
            ComposioToolPreview(
                description="Create and update delivery tickets.",
                name="Manage issues",
                slug="JIRA_MANAGE_ISSUES",
            ),
        ],
        slug="jira",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["payments", "finance"],
        description="Review customers, invoices, payments, and revenue workflows.",
        name="Stripe",
        sampleTools=[
            ComposioToolPreview(
                description="Review customer payment history.",
                name="List customers",
                slug="STRIPE_LIST_CUSTOMERS",
            ),
            ComposioToolPreview(
                description="Inspect invoices and revenue records.",
                name="List invoices",
                slug="STRIPE_LIST_INVOICES",
            ),
        ],
        slug="stripe",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["community", "messages"],
        description="Read servers, post updates, and coordinate community operations.",
        name="Discord",
        sampleTools=[
            ComposioToolPreview(
                description="Send updates to server channels.",
                name="Send message",
                slug="DISCORD_SEND_MESSAGE",
            ),
        ],
        slug="discord",
        toolsCount=0,
    ),
    ComposioApp(
        categories=["support", "messages"],
        description="Route customer conversations and prepare response workflows.",
        name="WhatsApp",
        sampleTools=[
            ComposioToolPreview(
                description="Prepare and route customer response workflows.",
                name="Message workflow",
                slug="WHATSAPP_MESSAGE_WORKFLOW",
            ),
        ],
        slug="whatsapp",
        toolsCount=0,
    ),
]

_CATALOG_ERROR: str | None = None


def is_composio_configured() -> bool:
    return bool(_api_key())


def is_composio_catalog_ready() -> bool:
    return is_composio_configured() and _CATALOG_ERROR is None


def get_composio_catalog_error() -> str | None:
    return _CATALOG_ERROR


def list_composio_apps() -> list[ComposioApp]:
    global _CATALOG_ERROR

    if not is_composio_configured():
        _CATALOG_ERROR = None
        return COMPOSIO_APP_CATALOG

    try:
        items = _fetch_all_toolkits()
        custom_auth_slugs = _fetch_toolkit_slugs_with_custom_auth()
    except Exception as exc:
        _CATALOG_ERROR = str(exc)
        return COMPOSIO_APP_CATALOG

    apps = [_toolkit_to_app(item, custom_auth_slugs=custom_auth_slugs) for item in items]
    apps = [app for app in apps if app.slug and app.name]
    _CATALOG_ERROR = None

    return sorted(apps, key=lambda app: app.name.lower()) or COMPOSIO_APP_CATALOG


def list_composio_app_tools(app_slug: str, limit: int = 4) -> list[ComposioToolPreview]:
    global _CATALOG_ERROR

    if not is_composio_configured():
        app = next((row for row in COMPOSIO_APP_CATALOG if row.slug == app_slug), None)
        return app.sampleTools[:limit] if app else []

    try:
        tools = _fetch_tool_preview(app_slug, limit)
    except Exception as exc:
        _CATALOG_ERROR = str(exc)
        app = next((row for row in COMPOSIO_APP_CATALOG if row.slug == app_slug), None)
        return app.sampleTools[:limit] if app else []

    return tools


def list_composio_accounts(user_id: str) -> list[ComposioConnectedAccount]:
    if not is_composio_configured():
        return []

    # Composio OpenAPI types these as arrays; pass lists so httpx encodes
    # user_ids=…&statuses=ACTIVE the way the API expects.
    params = {"user_ids": [user_id], "statuses": ["ACTIVE"], "limit": 1000}
    errors: list[str] = []

    # Connected Accounts are on the current v3.1 API. Keep a v3 fallback so
    # self-hosted deployments that override COMPOSIO_API_BASE_URL keep working,
    # but do not silently treat API drift as "no connected apps".
    for base_url in _dedupe_urls(_tools_api_base(), _api_base()):
        try:
            response = _get(base_url, "/connected_accounts", params=params, timeout=20)
            accounts = [_account_to_model(item) for item in _extract_items(response)]
            if not accounts:
                _log_empty_account_diagnostics(user_id, base_url)
            return accounts
        except Exception as exc:
            errors.append(f"{base_url}/connected_accounts: {exc}")

    logger.warning(
        "Could not list Composio connected accounts for user %s: %s",
        user_id,
        " | ".join(errors) or "unknown error",
    )
    return []


def _log_empty_account_diagnostics(user_id: str, base_url: str) -> None:
    """Log whether the Composio project has ACTIVE accounts under other user ids."""
    try:
        response = _get(
            base_url,
            "/connected_accounts",
            params={"statuses": ["ACTIVE"], "limit": 10},
            timeout=15,
        )
    except Exception as exc:
        logger.warning(
            "Composio returned no ACTIVE accounts for Verxio user %s; "
            "could not sample project accounts (%s)",
            user_id,
            exc,
        )
        return

    items = _extract_items(response)
    total = response.get("total_items") if isinstance(response, dict) else None
    other_ids: list[str] = []
    for item in items:
        other = str(item.get("user_id") or "").strip()
        if other and other != user_id and other not in other_ids:
            other_ids.append(other)
        if len(other_ids) >= 5:
            break

    logger.warning(
        "Composio returned no ACTIVE accounts for Verxio user %s. "
        "Project sample: total_items=%s other_user_ids=%s",
        user_id,
        total if total is not None else len(items),
        other_ids or "(none in sample)",
    )


def _dedupe_urls(*urls: str) -> list[str]:
    rows: list[str] = []
    seen: set[str] = set()
    for url in urls:
        normalized = str(url or "").rstrip("/")
        if normalized and normalized not in seen:
            rows.append(normalized)
            seen.add(normalized)
    return rows


def sync_composio_runtime_bridge(
    runtime: RuntimeInstance, user_id: str, accounts: list[ComposioConnectedAccount]
) -> ComposioToolBridgeStatus:
    """Expose connected Composio apps to Hermes as an MCP server.

    Composio connections live in Composio, while Hermes only sees callable
    tools through its configured tool registry. This bridge creates a
    Tool Router MCP session scoped to the user's active connected accounts and
    writes the session URL into the user's isolated Hermes config.
    """

    if not is_composio_configured():
        mcp_changed = _remove_runtime_mcp_server(runtime)
        prompt_changed = _remove_runtime_composio_prompt(runtime)
        changed = mcp_changed or prompt_changed
        return ComposioToolBridgeStatus(
            changed=changed,
            configured=False,
            enabled=False,
            message="Composio is not configured.",
            serverName=COMPOSIO_MCP_SERVER_NAME,
        )

    active_accounts = [account for account in accounts if _is_connected_status(account.status)]
    connected_accounts = _connected_accounts_by_app(active_accounts)
    connected_apps = sorted(connected_accounts)

    if not connected_apps:
        mcp_changed = _remove_runtime_mcp_server(runtime)
        config = _read_runtime_config(runtime)
        prompt_changed = _upsert_runtime_composio_prompt(config, [])
        if prompt_changed:
            _write_runtime_config(runtime, config)
        changed = mcp_changed or prompt_changed
        _bridge_state_path(runtime).unlink(missing_ok=True)
        return ComposioToolBridgeStatus(
            changed=changed,
            configured=True,
            enabled=False,
            message=(
                f"No ACTIVE Composio apps for Verxio user {user_id}. "
                "Reconnect Gmail and other apps under Skills → Connections on this environment "
                "(local connections do not carry over to production)."
            ),
            serverName=COMPOSIO_MCP_SERVER_NAME,
        )

    preload_tools = _composio_preload_tools()
    signature = _bridge_signature(user_id, connected_accounts, preload_tools)
    state = _read_bridge_state(runtime)
    mcp_url = str(state.get("mcp_url") or "").strip() if state.get("signature") == signature else ""

    try:
        created_session = False
        if not mcp_url:
            session = _create_tool_router_session(user_id, connected_accounts)
            mcp_url = _pick_mcp_url(session)
            if not mcp_url:
                raise RuntimeError("Composio did not return an MCP session URL.")
            created_session = True
            _write_bridge_state(
                runtime,
                {
                    "connected_apps": connected_apps,
                    "mcp_url": mcp_url,
                    "preload_tools": preload_tools,
                    "session_id": _pick_string(session, "id", "session_id", "sessionId"),
                    "signature": signature,
                },
            )

        config = _read_runtime_config(runtime)
        mcp_changed = _upsert_runtime_mcp_server(config, mcp_url)
        prompt_changed = _upsert_runtime_composio_prompt(config, connected_apps)
        if mcp_changed or prompt_changed:
            _write_runtime_config(runtime, config)
        changed = mcp_changed or prompt_changed or created_session
    except Exception as exc:
        return ComposioToolBridgeStatus(
            connectedApps=connected_apps,
            configured=True,
            enabled=False,
            message=f"Could not enable Composio tools in Verxio runtime: {exc}",
            serverName=COMPOSIO_MCP_SERVER_NAME,
        )

    return ComposioToolBridgeStatus(
        changed=changed,
        connectedApps=connected_apps,
        configured=True,
        enabled=True,
        message="Connected Composio tools are available to Verxio.",
        serverName=COMPOSIO_MCP_SERVER_NAME,
    )


def list_composio_trigger_types(app_slug: str) -> ComposioTriggerTypesResponse:
    if not is_composio_configured():
        return ComposioTriggerTypesResponse(triggers=[], configured=False)

    slug = app_slug.strip().lower()
    response = _get(
        _tools_api_base(),
        "/triggers_types",
        params={"limit": 100, "toolkit_slugs": [slug]},
        timeout=30,
    )
    triggers: list[ComposioTriggerType] = []
    for item in _extract_items(response):
        toolkit = item.get("toolkit") if isinstance(item.get("toolkit"), dict) else {}
        toolkit_slug = str(toolkit.get("slug") or toolkit.get("name") or "").strip().lower()
        if toolkit_slug and toolkit_slug != slug:
            continue
        trigger_slug = str(item.get("slug") or "").strip()
        trigger_type = str(item.get("type") or "").strip().lower()
        if not trigger_slug or trigger_type not in {"poll", "webhook"}:
            continue
        triggers.append(
            ComposioTriggerType(
                slug=trigger_slug,
                name=str(item.get("name") or trigger_slug),
                description=str(item.get("description") or ""),
                instructions=str(item.get("instructions") or ""),
                type=trigger_type,
                config=item.get("config") if isinstance(item.get("config"), dict) else {},
                payload=item.get("payload") if isinstance(item.get("payload"), dict) else {},
                requiresWebhookEndpointSetup=bool(item.get("requires_webhook_endpoint_setup")),
            )
        )
    triggers.sort(key=lambda item: item.name.lower())
    return ComposioTriggerTypesResponse(triggers=triggers, configured=True)


def ensure_composio_webhook_subscription(webhook_url: str) -> dict[str, Any]:
    if not is_composio_configured():
        raise HTTPException(status_code=409, detail="Composio is not configured.")
    normalized_url = webhook_url.strip()
    if not normalized_url.startswith("https://"):
        raise HTTPException(
            status_code=422,
            detail="Connected app triggers require VERXIO_PUBLIC_WEB_URL to be a public HTTPS URL.",
        )

    base_url = _tools_api_base()
    listed = _get(base_url, "/webhook_subscriptions", params={"limit": 1}, timeout=30)
    items = _extract_items(listed)
    desired = {
        "enabled_events": ["composio.trigger.message"],
        "version": "V3",
        "webhook_url": normalized_url,
    }
    subscription = (
        _patch(f"{base_url}/webhook_subscriptions/{items[0]['id']}", desired, timeout=30)
        if items
        else _post(f"{base_url}/webhook_subscriptions", desired, timeout=30)
    )
    if not isinstance(subscription, dict):
        raise HTTPException(status_code=502, detail="Composio returned an invalid webhook subscription.")
    subscription_id = str(subscription.get("id") or "").strip()
    secret = str(subscription.get("secret") or "").strip()
    if not subscription_id or not secret:
        raise HTTPException(status_code=502, detail="Composio did not return a webhook subscription secret.")
    db.execute(
        """
        INSERT INTO composio_webhook_subscription (id, webhook_url, secret, version, updated_at)
        VALUES (?, ?, ?, 'V3', ?)
        ON CONFLICT(id) DO UPDATE SET
            webhook_url = excluded.webhook_url,
            secret = excluded.secret,
            version = excluded.version,
            updated_at = excluded.updated_at
        """,
        (subscription_id, normalized_url, secret, now_iso()),
    )
    return subscription


def create_composio_trigger_instance(
    trigger_slug: str,
    *,
    connected_account_id: str,
    trigger_config: dict[str, Any],
    user_id: str,
) -> str:
    response = _post(
        f"{_tools_api_base()}/trigger_instances/{trigger_slug}/upsert",
        {
            "connected_account_id": connected_account_id,
            "trigger_config": trigger_config,
            "user_id": user_id,
        },
        timeout=60,
    )
    if not isinstance(response, dict):
        raise HTTPException(status_code=502, detail="Composio returned an invalid trigger instance.")
    trigger_id = str(response.get("trigger_id") or response.get("id") or "").strip()
    if not trigger_id:
        raise HTTPException(status_code=502, detail="Composio did not return a trigger instance id.")
    return trigger_id


def delete_composio_trigger_instance(trigger_id: str) -> None:
    if trigger_id:
        _delete(f"{_tools_api_base()}/trigger_instances/manage/{trigger_id}", timeout=30)


def set_composio_trigger_instance_enabled(trigger_id: str, enabled: bool) -> None:
    if trigger_id:
        _patch(
            f"{_tools_api_base()}/trigger_instances/manage/{trigger_id}",
            {"status": "enable" if enabled else "disable"},
            timeout=30,
        )


def verify_composio_webhook(
    body: bytes,
    *,
    webhook_id: str,
    webhook_timestamp: str,
    webhook_signature: str,
    tolerance_seconds: int = 300,
) -> dict[str, Any]:
    row = db.fetch_one("SELECT secret FROM composio_webhook_subscription ORDER BY updated_at DESC LIMIT 1")
    secret = str(row.get("secret") or "").strip() if row else ""
    if not secret:
        secret = os.getenv("COMPOSIO_WEBHOOK_SECRET", "").strip()
    if not secret:
        raise HTTPException(status_code=503, detail="Composio webhook verification is not configured.")
    if not webhook_id or not webhook_timestamp or not webhook_signature:
        raise HTTPException(status_code=401, detail="Missing Composio webhook signature headers.")
    try:
        timestamp = int(webhook_timestamp)
    except ValueError as exc:
        raise HTTPException(status_code=401, detail="Invalid Composio webhook timestamp.") from exc
    if tolerance_seconds > 0 and abs(int(time.time()) - timestamp) > tolerance_seconds:
        raise HTTPException(status_code=401, detail="Expired Composio webhook timestamp.")

    signing_string = f"{webhook_id}.{webhook_timestamp}.{body.decode('utf-8')}"
    expected = base64.b64encode(
        hmac.new(secret.encode(), signing_string.encode(), hashlib.sha256).digest()
    ).decode()
    received = webhook_signature.split(",", 1)[1] if "," in webhook_signature else webhook_signature
    if not hmac.compare_digest(expected, received):
        raise HTTPException(status_code=401, detail="Invalid Composio webhook signature.")
    try:
        payload = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Invalid Composio webhook JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Invalid Composio webhook payload.")
    return payload


def claim_composio_webhook(webhook_id: str) -> bool:
    completed_cutoff = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    abandoned_cutoff = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    with db.transaction() as conn:
        conn.execute(
            """
            DELETE FROM composio_webhook_receipts
            WHERE (completed_at IS NOT NULL AND completed_at < ?)
               OR (completed_at IS NULL AND received_at < ?)
            """,
            (completed_cutoff, abandoned_cutoff),
        )
        cursor = conn.execute(
            """
            INSERT INTO composio_webhook_receipts (webhook_id, received_at)
            VALUES (?, ?)
            ON CONFLICT(webhook_id) DO NOTHING
            """,
            (webhook_id, now_iso()),
        )
        return cursor.rowcount > 0


def complete_composio_webhook(webhook_id: str) -> None:
    db.execute(
        "UPDATE composio_webhook_receipts SET completed_at = ? WHERE webhook_id = ?",
        (now_iso(), webhook_id),
    )


def release_composio_webhook(webhook_id: str) -> None:
    db.execute(
        "DELETE FROM composio_webhook_receipts WHERE webhook_id = ? AND completed_at IS NULL",
        (webhook_id,),
    )


def initiate_composio_connection(
    user_id: str, app_slug: str, callback_url: str | None = None
) -> ComposioInitiateResponse:
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")

    slug = app_slug.strip().lower()
    if not slug:
        raise HTTPException(status_code=400, detail="appSlug is required.")

    toolkit = _fetch_toolkit_by_slug(slug)
    if toolkit is None:
        raise HTTPException(status_code=404, detail=f"Toolkit '{slug}' was not found in Composio.")

    auth_mode = _resolve_effective_auth_mode(toolkit)
    if auth_mode == "requires_oauth_app":
        name = str(toolkit.get("name") or slug)
        raise HTTPException(
            status_code=400,
            detail=(
                f"{name} requires an OAuth app configured in Composio before users can connect. "
                "Create a custom auth config in the Composio dashboard with your client credentials."
            ),
        )
    if auth_mode == "no_auth":
        raise HTTPException(status_code=400, detail="This integration does not require authentication.")

    try:
        if auth_mode == "managed_oauth":
            auth_config_id = _resolve_managed_auth_config_id(slug)
        else:
            auth_scheme = _pick_auth_scheme_for_connect(toolkit)
            auth_config_id = _resolve_custom_auth_config_id(slug, auth_scheme)
        response = _post(
            f"{_tools_api_base()}/connected_accounts/link",
            {
                "auth_config_id": auth_config_id,
                "user_id": user_id,
                "callback_url": callback_url or _default_callback_url(),
            },
            timeout=30,
        )
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc

    redirect_url = _pick_string(response, "redirect_url", "redirectUrl")
    connection_id = _pick_string(response, "connected_account_id", "connectedAccountId", "id")

    if not redirect_url:
        raise HTTPException(status_code=502, detail="Composio did not return a redirect URL.")

    return ComposioInitiateResponse(redirectUrl=redirect_url, connectionId=connection_id or "")


def get_composio_connection_setup(app_slug: str) -> ComposioConnectionSetupResponse:
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")

    slug = app_slug.strip().lower()
    if not slug:
        raise HTTPException(status_code=400, detail="appSlug is required.")

    toolkit = _fetch_toolkit_by_slug(slug)
    if toolkit is None:
        raise HTTPException(status_code=404, detail=f"Toolkit '{slug}' was not found in Composio.")

    auth_mode = _resolve_effective_auth_mode(toolkit)
    name = str(toolkit.get("name") or slug)
    auth_scheme: str | None = None
    input_fields: list[ComposioAuthInputField] = []
    supports_inline = False
    supports_link = auth_mode in {"managed_oauth", "connect_link"}

    if auth_mode == "managed_oauth":
        managed = toolkit.get("composio_managed_auth_schemes")
        if isinstance(managed, list) and managed:
            auth_scheme = str(managed[0]).upper()
    elif auth_mode == "connect_link":
        auth_scheme = _pick_auth_scheme_for_connect(toolkit)
        input_fields = _load_connection_setup_fields(slug, auth_scheme)
        supports_inline = len(input_fields) > 0
    elif auth_mode == "requires_oauth_app":
        auth_scheme = _pick_oauth_auth_scheme(toolkit)
        input_fields = _load_connection_setup_fields(slug, auth_scheme)
        supports_inline = len(input_fields) > 0

    return ComposioConnectionSetupResponse(
        appSlug=slug,
        authMode=auth_mode,
        authScheme=auth_scheme,
        inputFields=input_fields,
        name=name,
        supportsInline=supports_inline,
        supportsLink=supports_link,
    )


def complete_composio_connection(
    user_id: str, app_slug: str, credentials: dict[str, str]
) -> ComposioCompleteConnectionResponse:
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")

    slug = app_slug.strip().lower()
    if not slug:
        raise HTTPException(status_code=400, detail="appSlug is required.")

    toolkit = _fetch_toolkit_by_slug(slug)
    if toolkit is None:
        raise HTTPException(status_code=404, detail=f"Toolkit '{slug}' was not found in Composio.")

    auth_mode = _resolve_effective_auth_mode(toolkit)
    base_mode = _resolve_toolkit_auth_mode(toolkit)
    if auth_mode not in {"connect_link", "requires_oauth_app"}:
        raise HTTPException(
            status_code=400,
            detail="Inline credentials are only supported for API key and credential-based integrations.",
        )

    auth_scheme = _pick_auth_scheme_for_connect(toolkit)
    try:
        if base_mode == "requires_oauth_app" or auth_scheme in OAUTH_APP_AUTH_SCHEMES:
            credential_payload = _build_oauth_app_credential_payload(credentials)
            auth_config_id = _save_custom_auth_config_credentials(slug, auth_scheme, credential_payload)
            return ComposioCompleteConnectionResponse(connectionId=auth_config_id, status="AUTH_CONFIG_READY")

        auth_config_id = _resolve_custom_auth_config_id(slug, auth_scheme)
        auth_config = _fetch_auth_config(auth_config_id)
        credential_payload = _build_credential_payload(auth_config, credentials)
        response = _post(
            f"{_api_base()}/connected_accounts",
            {
                "auth_config": {"id": auth_config_id},
                "connection": {
                    "data": credential_payload,
                    "user_id": user_id,
                },
            },
            timeout=30,
        )
    except RuntimeError as exc:
        message = str(exc)
        if "Missing required" in message or "credential field" in message or "At least one credential" in message:
            raise HTTPException(status_code=400, detail=message) from exc
        raise HTTPException(status_code=502, detail=message) from exc

    connection_id = _pick_string(
        response,
        "id",
        "connected_account_id",
        "connectedAccountId",
    )
    if not connection_id and isinstance(response.get("connection"), dict):
        connection_id = _pick_string(response["connection"], "id", "connected_account_id", "connectedAccountId")

    status = _pick_string(response, "status") or "ACTIVE"
    if not connection_id:
        raise HTTPException(status_code=502, detail="Composio did not return a connected account id.")

    return ComposioCompleteConnectionResponse(connectionId=connection_id, status=status)


def delete_composio_account(account_id: str) -> dict[str, str]:
    if not is_composio_configured():
        raise HTTPException(status_code=500, detail="Composio is not configured.")

    account_id = account_id.strip()
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required.")

    errors: list[str] = []
    for base_url in _dedupe_urls(_tools_api_base(), _api_base()):
        try:
            _delete(f"{base_url}/connected_accounts/{account_id}", timeout=20)
            return disconnected_response()
        except RuntimeError as exc:
            errors.append(str(exc))

    message = errors[-1] if errors else "Composio request failed."
    raise HTTPException(status_code=502, detail=message)


def disconnected_response() -> dict[str, str]:
    return {"message": "Connection removed."}


def _is_connected_status(status: str) -> bool:
    normalized = status.strip().lower()
    return bool(normalized and normalized not in {"deleted", "disabled", "disconnected", "failed", "inactive"})


def _connected_accounts_by_app(accounts: list[ComposioConnectedAccount]) -> dict[str, list[str]]:
    rows: dict[str, list[str]] = {}

    for account in accounts:
        app_slug = account.appSlug.strip().lower()
        account_id = account.id.strip()

        if not app_slug or not account_id or app_slug == "unknown":
            continue

        rows.setdefault(app_slug, []).append(account_id)

    return {slug: sorted(set(ids)) for slug, ids in rows.items() if ids}


def _bridge_signature(
    user_id: str,
    connected_accounts: dict[str, list[str]],
    preload_tools: str | list[str] | None = None,
) -> str:
    payload = {
        "connected_accounts": connected_accounts,
        "preload_tools": preload_tools,
        "user_id": user_id,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _bridge_state_path(runtime: RuntimeInstance) -> Path:
    state_dir = Path(runtime.hermes_home_path) / ".verxio"
    state_dir.mkdir(parents=True, exist_ok=True)
    return state_dir / COMPOSIO_BRIDGE_STATE_FILE


def _read_bridge_state(runtime: RuntimeInstance) -> dict[str, Any]:
    path = _bridge_state_path(runtime)
    if not path.exists():
        return {}

    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}

    return payload if isinstance(payload, dict) else {}


def _write_bridge_state(runtime: RuntimeInstance, payload: dict[str, Any]) -> None:
    path = _bridge_state_path(runtime)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")


def _create_tool_router_session(user_id: str, connected_accounts: dict[str, list[str]]) -> dict[str, Any]:
    toolkits = sorted(connected_accounts)
    preload_tools = _composio_preload_tools()
    payload: dict[str, Any] = {
        "connected_accounts": connected_accounts,
        "manage_connections": {
            "enable": False,
            "enable_connection_removal": False,
            "enable_wait_for_connections": False,
        },
        "search": {"enable": True},
        "toolkits": {"enable": toolkits},
        "user_id": user_id,
        "workbench": {"enable": False, "enable_proxy_execution": False},
    }

    if preload_tools is not None:
        payload["preload"] = {"tools": preload_tools}

    response = _post(f"{_tools_api_base()}/tool_router/session", payload, timeout=30)
    return response if isinstance(response, dict) else {}


def _composio_preload_tools() -> str | list[str] | None:
    """Return the optional Composio Tool Router preload setting.

    The Tool Router rejects ``preload.tools="all"`` once a user's connected
    app scope exceeds 1000 tools. Large toolkits such as GitHub can cross that
    limit by themselves, so Verxio defaults to no broad preload and relies on
    the router's scoped search/execute tools instead.
    """
    raw = os.getenv("COMPOSIO_MCP_PRELOAD_TOOLS", "").strip()

    if not raw or raw.lower() in {"0", "false", "none", "off"}:
        return None

    if "," in raw:
        tools = [part.strip() for part in raw.split(",") if part.strip()]
        return tools or None

    return raw


def _pick_mcp_url(payload: dict[str, Any]) -> str:
    mcp = payload.get("mcp")
    if isinstance(mcp, dict):
        value = _pick_string(mcp, "url", "mcp_url", "mcpUrl")
        if value:
            return value

    return _pick_string(payload, "mcp_url", "mcpUrl")


def _runtime_config_path(runtime: RuntimeInstance) -> Path:
    path = Path(runtime.hermes_home_path)
    path.mkdir(parents=True, exist_ok=True)
    return path / "config.yaml"


def _read_runtime_config(runtime: RuntimeInstance) -> dict[str, Any]:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return {}

    try:
        payload = yaml.safe_load(config_path.read_text(encoding="utf-8")) or {}
    except yaml.YAMLError as exc:
        raise RuntimeError(f"Hermes config is not valid YAML: {exc}") from exc

    return payload if isinstance(payload, dict) else {}


def _write_runtime_config(runtime: RuntimeInstance, config: dict[str, Any]) -> None:
    config_path = _runtime_config_path(runtime)
    rendered = yaml.safe_dump(config, allow_unicode=False, sort_keys=False)
    config_path.write_text(rendered, encoding="utf-8")


def _upsert_runtime_mcp_server(config: dict[str, Any], mcp_url: str) -> bool:
    servers = config.get("mcp_servers")

    if not isinstance(servers, dict):
        servers = {}

    desired = {
        "connect_timeout": 30,
        "enabled": True,
        "headers": {"x-api-key": "${COMPOSIO_API_KEY}"},
        "supports_parallel_tool_calls": False,
        "timeout": 120,
        "url": mcp_url,
    }

    if servers.get(COMPOSIO_MCP_SERVER_NAME) == desired:
        return False

    servers[COMPOSIO_MCP_SERVER_NAME] = desired
    config["mcp_servers"] = servers

    if "terminal" not in config:
        config["terminal"] = {"backend": "local", "cwd": "/workspace"}

    return True


def _remove_runtime_mcp_server(runtime: RuntimeInstance) -> bool:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return False

    try:
        config = _read_runtime_config(runtime)
    except RuntimeError:
        return False

    servers = config.get("mcp_servers")
    if not isinstance(servers, dict) or COMPOSIO_MCP_SERVER_NAME not in servers:
        return False

    servers.pop(COMPOSIO_MCP_SERVER_NAME, None)
    if servers:
        config["mcp_servers"] = servers
    else:
        config.pop("mcp_servers", None)

    _write_runtime_config(runtime, config)
    return True


def _upsert_runtime_composio_prompt(config: dict[str, Any], connected_apps: list[str]) -> bool:
    agent = config.get("agent")
    if not isinstance(agent, dict):
        agent = {}

    current_prompt = agent.get("system_prompt")
    base_prompt = _strip_managed_composio_prompt(str(current_prompt or ""))
    desired_prompt = _join_prompt_parts(base_prompt, _build_composio_context_prompt(connected_apps))

    if current_prompt == desired_prompt:
        return False

    agent["system_prompt"] = desired_prompt
    config["agent"] = agent
    return True


def _remove_runtime_composio_prompt(runtime: RuntimeInstance) -> bool:
    config_path = _runtime_config_path(runtime)
    if not config_path.exists():
        return False

    try:
        config = _read_runtime_config(runtime)
    except RuntimeError:
        return False

    agent = config.get("agent")
    if not isinstance(agent, dict):
        return False

    current_prompt = agent.get("system_prompt")
    if not isinstance(current_prompt, str) or COMPOSIO_PROMPT_START not in current_prompt:
        return False

    next_prompt = _strip_managed_composio_prompt(current_prompt)
    if next_prompt:
        agent["system_prompt"] = next_prompt
    else:
        agent.pop("system_prompt", None)
    config["agent"] = agent
    _write_runtime_config(runtime, config)
    return True


def _strip_managed_composio_prompt(prompt: str) -> str:
    start = prompt.find(COMPOSIO_PROMPT_START)
    end = prompt.find(COMPOSIO_PROMPT_END)
    if start == -1 or end == -1 or end < start:
        return prompt.strip()

    end += len(COMPOSIO_PROMPT_END)
    return (prompt[:start] + prompt[end:]).strip()


def _join_prompt_parts(*parts: str) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


def _build_composio_context_prompt(connected_apps: list[str]) -> str:
    labels = [_composio_app_label(slug) for slug in connected_apps]
    app_lines = [f"- {label} (`{slug}`)" for slug, label in zip(connected_apps, labels, strict=False)]
    app_list = "\n".join(app_lines) if app_lines else "- None"

    if not connected_apps:
        return "\n".join(
            [
                COMPOSIO_PROMPT_START,
                "## Verxio Connected Apps",
                "",
                "Composio is configured on this runtime (`COMPOSIO_API_KEY` may be present), but this Verxio user currently has **no ACTIVE connected apps**.",
                "",
                "Connected apps:",
                "- None",
                "",
                "Before saying an app is unavailable, still call `mcp_composio_COMPOSIO_SEARCH_TOOLS` for that app once. Only then tell the user to open **Skills → Connections** and reconnect.",
                "Do NOT treat `COMPOSIO_API_KEY` as proof that Gmail/Slack/GitHub/etc. are connected.",
                "Do NOT call Composio REST/v1/v3 endpoints, install the Composio SDK, or dig through env files for OAuth tokens.",
                "Local desktop connections do not automatically appear in hosted production — each environment uses its own Verxio user id.",
                COMPOSIO_PROMPT_END,
            ]
        )

    return "\n".join(
        [
            COMPOSIO_PROMPT_START,
            "## Verxio Connected Apps",
            "",
            "Verxio app connections are managed through Composio.",
            "",
            "Connected apps:",
            app_list,
            "",
            "Mandatory first step when the user asks to use a connected app (Gmail, Google Sheets, Calendar, Drive, Docs, Slack, Notion, etc.):",
            "1. Read this Connected Apps list.",
            "2. Immediately call `mcp_composio_COMPOSIO_SEARCH_TOOLS` for that toolkit (for example `googlesheets` or `gmail`) before writing files, scraping URLs, or saying the app is disconnected.",
            "3. Execute with `mcp_composio_COMPOSIO_MULTI_EXECUTE_TOOL` or the discovered `mcp_composio_*` tool.",
            "Google Docs / long content rules (critical on messaging and web):",
            "- Pass `COMPOSIO_MULTI_EXECUTE_TOOL.tools` as a native JSON array of objects, never as a stringified JSON blob.",
            "- For reports longer than ~1500 characters: write the full markdown under `/workspace/artifacts/` first, create the Google Doc (title/metadata), then populate it in small section chunks (Part 1, Part 2, ...) with `GOOGLEDOCS_UPDATE_DOCUMENT_MARKDOWN` / section-update tools. One huge markdown payload in a single tool call often fails JSON validation.",
            "- Prefer `read_file` on each artifact chunk, then one Composio execute per chunk. Do not paste the entire report into one `tools` argument.",
            "- If a create succeeds but content write fails, retry with smaller chunks; do not claim Composio is disconnected.",
            "Treat this connected-app list as the source of truth for Verxio. Do not invent connection status from missing env files, Google token paths, or bare tool names.",
            "Verxio exposes Composio tools with the `mcp_composio_` prefix (for example `mcp_composio_GOOGLESHEETS_BATCH_GET` or `mcp_composio_COMPOSIO_SEARCH_TOOLS`). Use those callable tools directly; do not wait for bare `GMAIL_*` / `GOOGLESHEETS_*` names.",
            "Do not report a connected Verxio app as disconnected just because legacy runtime credential files or environment variables are missing, including `/opt/data/google_token.json`, `/opt/data/google_client_secret.json`, `NOTION_API_KEY`, or `NOTION_API_TOKEN`.",
            "Only mention those legacy credential paths if the user explicitly asks about legacy runtime integrations.",
            "If an app is not listed above and search/execute fails with an auth or connection error, say it is not connected in Verxio and can be connected from Skills > Connections.",
            COMPOSIO_PROMPT_END,
        ]
    )


def _composio_app_label(slug: str) -> str:
    app = next((item for item in COMPOSIO_APP_CATALOG if item.slug == slug), None)
    if app:
        return app.name
    return slug.replace("_", " ").replace("-", " ").title()


def _api_key() -> str:
    return os.getenv("COMPOSIO_API_KEY", "").strip()


def _api_base() -> str:
    return os.getenv("COMPOSIO_API_BASE_URL", "https://backend.composio.dev/api/v3").rstrip("/")


def _tools_api_base() -> str:
    return os.getenv("COMPOSIO_TOOLS_API_BASE_URL", "https://backend.composio.dev/api/v3.1").rstrip("/")


def _headers() -> dict[str, str]:
    key = _api_key()
    return {"x-api-key": key}


def _get(base_url: str, path: str, params: dict[str, Any] | None = None, timeout: int = 30) -> Any:
    response = httpx.get(f"{base_url}{path}", headers=_headers(), params=params or {}, timeout=timeout)
    if response.status_code >= 400:
        raise RuntimeError(_format_composio_error(response))
    return response.json()


def _post(url: str, payload: dict[str, Any], timeout: int = 30) -> Any:
    response = httpx.post(url, headers={**_headers(), "Content-Type": "application/json"}, json=payload, timeout=timeout)
    if response.status_code >= 400:
        raise RuntimeError(_format_composio_error(response))
    return response.json()


def _patch(url: str, payload: dict[str, Any], timeout: int = 30) -> Any:
    response = httpx.patch(url, headers={**_headers(), "Content-Type": "application/json"}, json=payload, timeout=timeout)
    if response.status_code >= 400:
        raise RuntimeError(_format_composio_error(response))
    return response.json()


def _delete(url: str, timeout: int = 30) -> Any:
    response = httpx.delete(url, headers=_headers(), timeout=timeout)
    if response.status_code >= 400:
        raise RuntimeError(_format_composio_error(response))
    if not response.content:
        return {}
    return response.json()


def _patch(url: str, payload: dict[str, Any], timeout: int = 30) -> Any:
    response = httpx.patch(
        url,
        headers={**_headers(), "Content-Type": "application/json"},
        json=payload,
        timeout=timeout,
    )
    if response.status_code >= 400:
        raise RuntimeError(_format_composio_error(response))
    if not response.content:
        return {}
    return response.json()


CONNECT_LINK_AUTH_SCHEMES = frozenset({"API_KEY", "BASIC", "BEARER_TOKEN", "BASIC_WITH_JWT"})
OAUTH_APP_AUTH_SCHEMES = frozenset({"OAUTH2", "OAUTH1", "DCR_OAUTH", "S2S_OAUTH2", "SAML"})


def _normalize_auth_schemes(item: dict[str, Any]) -> list[str]:
    schemes = item.get("auth_schemes")
    if not isinstance(schemes, list):
        return []

    return [str(scheme).upper() for scheme in schemes if scheme]


def _resolve_toolkit_auth_mode(item: dict[str, Any]) -> str:
    if bool(item.get("noAuth") or item.get("no_auth")):
        return "no_auth"

    managed = item.get("composio_managed_auth_schemes")
    if isinstance(managed, list) and len(managed) > 0:
        return "managed_oauth"

    schemes = _normalize_auth_schemes(item)
    if any(scheme in CONNECT_LINK_AUTH_SCHEMES for scheme in schemes):
        return "connect_link"
    if any(scheme in OAUTH_APP_AUTH_SCHEMES for scheme in schemes):
        return "requires_oauth_app"
    if schemes:
        return "connect_link"

    return "requires_oauth_app"


def _resolve_effective_auth_mode(
    item: dict[str, Any],
    *,
    custom_auth_slugs: set[str] | None = None,
) -> str:
    mode = _resolve_toolkit_auth_mode(item)
    if mode != "requires_oauth_app":
        return mode

    slug = str(item.get("slug") or item.get("toolkit_slug") or "").lower()
    if not slug:
        return mode

    if custom_auth_slugs is not None:
        return "connect_link" if slug in custom_auth_slugs else mode

    auth_scheme = _pick_oauth_auth_scheme(item)
    if _find_existing_custom_auth_config(slug, auth_scheme):
        return "connect_link"

    return mode


def _toolkit_is_connectable(item: dict[str, Any], *, custom_auth_slugs: set[str] | None = None) -> bool:
    return _resolve_effective_auth_mode(item, custom_auth_slugs=custom_auth_slugs) != "requires_oauth_app"


def _pick_oauth_auth_scheme(item: dict[str, Any]) -> str:
    schemes = _normalize_auth_schemes(item)
    for scheme in schemes:
        if scheme in OAUTH_APP_AUTH_SCHEMES:
            return scheme

    return "OAUTH2"


def _pick_auth_scheme_for_connect(item: dict[str, Any]) -> str:
    schemes = _normalize_auth_schemes(item)
    for scheme in schemes:
        if scheme in CONNECT_LINK_AUTH_SCHEMES:
            return scheme
    for scheme in schemes:
        if scheme in OAUTH_APP_AUTH_SCHEMES:
            return scheme

    return schemes[0] if schemes else "API_KEY"


def _pick_connect_link_auth_scheme(item: dict[str, Any]) -> str:
    return _pick_auth_scheme_for_connect(item)


def _fetch_toolkit_slugs_with_custom_auth() -> set[str]:
    slugs: set[str] = set()
    cursor: str | None = None

    for _ in range(20):
        params: dict[str, Any] = {"limit": 100}
        if cursor:
            params["cursor"] = cursor

        response = _get(_tools_api_base(), "/auth_configs", params=params, timeout=20)
        for item in _extract_items(response):
            if bool(item.get("is_composio_managed")):
                continue
            if str(item.get("status") or "ENABLED").upper() == "DISABLED":
                continue

            toolkit = item.get("toolkit") if isinstance(item.get("toolkit"), dict) else {}
            slug = str(toolkit.get("slug") or item.get("toolkit_slug") or "").lower()
            if slug:
                slugs.add(slug)

        cursor = _next_cursor(response)
        if not cursor:
            break

    return slugs


def _default_oauth_input_fields() -> list[ComposioAuthInputField]:
    return [
        ComposioAuthInputField(
            description="OAuth client ID from the provider developer portal.",
            displayName="Client ID",
            name="client_id",
            required=True,
        ),
        ComposioAuthInputField(
            description="OAuth client secret from the provider developer portal.",
            displayName="Client Secret",
            isSecret=True,
            name="client_secret",
            required=True,
        ),
    ]


def _load_connection_setup_fields(app_slug: str, auth_scheme: str) -> list[ComposioAuthInputField]:
    target_scheme = auth_scheme.upper()
    auth_config_id: str | None = None
    try:
        auth_config_id = _find_existing_custom_auth_config(app_slug, target_scheme)
    except RuntimeError:
        auth_config_id = None

    if auth_config_id:
        try:
            auth_config = _fetch_auth_config(auth_config_id)
            fields = _parse_expected_input_fields(auth_config)
            if fields:
                return fields
        except RuntimeError:
            pass

    if target_scheme in OAUTH_APP_AUTH_SCHEMES:
        return _default_oauth_input_fields()

    try:
        auth_config_id = _resolve_custom_auth_config_id(app_slug, target_scheme)
        auth_config = _fetch_auth_config(auth_config_id)
        return _parse_expected_input_fields(auth_config)
    except RuntimeError:
        return []


def _composio_oauth_redirect_uri() -> str:
    return os.getenv(
        "COMPOSIO_OAUTH_REDIRECT_URI",
        "https://backend.composio.dev/api/v3.1/toolkits/auth/callback",
    ).strip()


def _build_oauth_app_credential_payload(credentials: dict[str, str]) -> dict[str, str]:
    payload: dict[str, str] = {}
    missing: list[str] = []

    for field in _default_oauth_input_fields():
        value = str(credentials.get(field.name) or "").strip()
        if not value and field.required:
            missing.append(field.displayName)
            continue
        if value:
            payload[field.name] = value

    if missing:
        raise RuntimeError(f"Missing required fields: {', '.join(missing)}.")

    # Composio hosts the OAuth callback; include it so custom Google apps can complete.
    redirect_uri = str(credentials.get("oauth_redirect_uri") or "").strip() or _composio_oauth_redirect_uri()
    if redirect_uri:
        payload["oauth_redirect_uri"] = redirect_uri

    return payload


def _save_custom_auth_config_credentials(
    app_slug: str, auth_scheme: str, credentials: dict[str, str]
) -> str:
    target_scheme = auth_scheme.upper()
    existing = _find_existing_custom_auth_config(app_slug, target_scheme)
    if existing:
        # Composio update schema discriminator is "custom" | "default"
        # (create still uses "use_custom_auth").
        _patch(
            f"{_tools_api_base()}/auth_configs/{existing}",
            {"type": "custom", "credentials": credentials},
            timeout=20,
        )
        return existing

    created = _post(
        f"{_tools_api_base()}/auth_configs",
        {
            "toolkit": {"slug": app_slug},
            "auth_config": {
                "type": "use_custom_auth",
                "authScheme": target_scheme,
                "name": f"Verxio {app_slug}",
                "credentials": credentials,
                "restrict_to_following_tools": [],
            },
        },
        timeout=20,
    )
    auth_config = created.get("auth_config") if isinstance(created.get("auth_config"), dict) else {}
    auth_config_id = str(auth_config.get("id") or created.get("id") or "").strip()
    if not auth_config_id:
        raise RuntimeError(f"Could not create a Composio auth config for {app_slug}.")
    return auth_config_id


def _find_existing_custom_auth_config(app_slug: str, auth_scheme: str) -> str | None:
    response = _get(
        _tools_api_base(),
        "/auth_configs",
        params={"toolkit_slug": app_slug, "limit": 20},
        timeout=20,
    )
    target_scheme = auth_scheme.upper()
    for item in _extract_items(response):
        if bool(item.get("is_composio_managed")):
            continue
        if str(item.get("status") or "ENABLED").upper() == "DISABLED":
            continue
        scheme = str(item.get("auth_scheme") or item.get("authScheme") or "").upper()
        if scheme != target_scheme:
            continue
        auth_config_id = str(item.get("id") or "").strip()
        if auth_config_id:
            return auth_config_id

    return None


def _fetch_toolkit_by_slug(app_slug: str) -> dict[str, Any] | None:
    response = _get(
        _api_base(),
        "/toolkits",
        params={"search": app_slug, "limit": 20},
        timeout=20,
    )
    for item in _extract_items(response):
        if str(item.get("slug") or "").lower() == app_slug:
            return item
    return None


def _resolve_managed_auth_config_id(app_slug: str) -> str:
    response = _get(
        _tools_api_base(),
        "/auth_configs",
        params={"toolkit_slug": app_slug, "limit": 10, "is_composio_managed": "true"},
        timeout=20,
    )
    for item in _extract_items(response):
        if str(item.get("status") or "ENABLED").upper() == "DISABLED":
            continue
        auth_config_id = str(item.get("id") or "").strip()
        if auth_config_id:
            return auth_config_id

    created = _post(
        f"{_tools_api_base()}/auth_configs",
        {
            "toolkit": {"slug": app_slug},
            "auth_config": {
                "type": "use_composio_managed_auth",
                "credentials": {},
                "restrict_to_following_tools": [],
            },
        },
        timeout=20,
    )
    auth_config = created.get("auth_config") if isinstance(created.get("auth_config"), dict) else {}
    auth_config_id = str(auth_config.get("id") or created.get("id") or "").strip()
    if not auth_config_id:
        raise RuntimeError(f"Could not create a Composio auth config for {app_slug}.")
    return auth_config_id


def _resolve_custom_auth_config_id(app_slug: str, auth_scheme: str) -> str:
    response = _get(
        _tools_api_base(),
        "/auth_configs",
        params={"toolkit_slug": app_slug, "limit": 20},
        timeout=20,
    )
    target_scheme = auth_scheme.upper()
    for item in _extract_items(response):
        if str(item.get("status") or "ENABLED").upper() == "DISABLED":
            continue
        scheme = str(item.get("auth_scheme") or item.get("authScheme") or "").upper()
        if scheme != target_scheme:
            continue
        auth_config_id = str(item.get("id") or "").strip()
        if auth_config_id:
            return auth_config_id

    created = _post(
        f"{_tools_api_base()}/auth_configs",
        {
            "toolkit": {"slug": app_slug},
            "auth_config": {
                "type": "use_custom_auth",
                "authScheme": target_scheme,
                "credentials": {},
                "restrict_to_following_tools": [],
            },
        },
        timeout=20,
    )
    auth_config = created.get("auth_config") if isinstance(created.get("auth_config"), dict) else {}
    auth_config_id = str(auth_config.get("id") or created.get("id") or "").strip()
    if not auth_config_id:
        raise RuntimeError(f"Could not create a Composio auth config for {app_slug}.")
    return auth_config_id


def _fetch_auth_config(auth_config_id: str) -> dict[str, Any]:
    response = _get(_tools_api_base(), f"/auth_configs/{auth_config_id}", timeout=20)
    return response if isinstance(response, dict) else {}


def _parse_expected_input_fields(auth_config: dict[str, Any]) -> list[ComposioAuthInputField]:
    fields = auth_config.get("expected_input_fields")
    if not isinstance(fields, list):
        return []

    parsed: list[ComposioAuthInputField] = []
    for field in fields:
        if not isinstance(field, dict):
            continue
        name = str(field.get("name") or "").strip()
        if not name:
            continue
        parsed.append(
            ComposioAuthInputField(
                description=str(field.get("description") or ""),
                displayName=str(field.get("displayName") or field.get("display_name") or name),
                isSecret=bool(field.get("is_secret") or field.get("isSecret")),
                name=name,
                required=bool(field.get("required", True)),
                type=str(field.get("type") or "string"),
            )
        )

    return parsed


def _build_credential_payload(auth_config: dict[str, Any], credentials: dict[str, str]) -> dict[str, str]:
    input_fields = _parse_expected_input_fields(auth_config)
    if not input_fields:
        raise RuntimeError("This integration does not expose inline credential fields.")

    payload: dict[str, str] = {}
    missing: list[str] = []

    for field in input_fields:
        value = str(credentials.get(field.name) or "").strip()
        if not value and field.required:
            missing.append(field.displayName)
            continue
        if value:
            payload[field.name] = value

    if missing:
        raise RuntimeError(f"Missing required fields: {', '.join(missing)}.")

    if not payload:
        raise RuntimeError("At least one credential field is required.")

    return payload


def _default_callback_url() -> str:
    return os.getenv("COMPOSIO_CALLBACK_URL", "http://127.0.0.1:8080/#/skills").strip()


def _pick_string(payload: Any, *keys: str) -> str:
    if not isinstance(payload, dict):
        return ""
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _format_composio_error(response: httpx.Response) -> str:
    try:
        payload = response.json()
    except ValueError:
        return f"Composio request failed ({response.status_code})."

    if not isinstance(payload, dict):
        return f"Composio request failed ({response.status_code})."

    error = payload.get("error")
    if isinstance(error, dict):
        message = error.get("message") or error.get("detail")
        if isinstance(message, str) and message.strip():
            errors = error.get("errors")
            if isinstance(errors, list) and errors:
                details = "; ".join(str(item) for item in errors if item)
                if details:
                    return f"{message.strip()} ({details})"
            return message.strip()

    detail = payload.get("detail")
    if isinstance(detail, str) and detail.strip():
        return detail.strip()

    return f"Composio request failed ({response.status_code})."


def _fetch_all_toolkits() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    cursor: str | None = None

    for _ in range(20):
        params: dict[str, Any] = {"limit": 1000}
        if cursor:
            params["cursor"] = cursor

        response = _get(_api_base(), "/toolkits", params=params, timeout=45)
        rows.extend(_extract_items(response))
        cursor = _next_cursor(response)
        if not cursor:
            break

    return rows


def _fetch_tool_preview(app_slug: str, limit: int) -> list[ComposioToolPreview]:
    params = {
        "toolkit_slug": app_slug.lower(),
        "limit": max(1, min(limit, 100)),
        "include_deprecated": "false",
        "important": "true",
    }
    response = _get(_tools_api_base(), "/tools", params=params, timeout=20)
    items = _extract_items(response)

    if not items:
        params.pop("important", None)
        response = _get(_tools_api_base(), "/tools", params=params, timeout=20)
        items = _extract_items(response)

    return [_tool_to_preview(item) for item in items[:limit]]


def _extract_items(response: Any) -> list[dict[str, Any]]:
    if isinstance(response, list):
        return [item for item in response if isinstance(item, dict)]

    if not isinstance(response, dict):
        return []

    for key in ("items", "data", "toolkits", "tools", "connected_accounts"):
        value = response.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]

    return []


def _next_cursor(response: Any) -> str | None:
    if not isinstance(response, dict):
        return None

    for key in ("next_cursor", "nextCursor", "cursor"):
        value = response.get(key)
        if isinstance(value, str) and value:
            return value

    return None


def _toolkit_to_app(item: dict[str, Any], *, custom_auth_slugs: set[str] | None = None) -> ComposioApp:
    meta = item.get("meta") if isinstance(item.get("meta"), dict) else {}
    slug = str(item.get("slug") or item.get("toolkit_slug") or "").lower()
    name = str(item.get("name") or meta.get("name") or slug.replace("_", " ").title())
    tools_count = _int_or_none(meta.get("toolsCount") or meta.get("tools_count"))
    triggers_count = _int_or_none(meta.get("triggersCount") or meta.get("triggers_count"))

    auth_mode = _resolve_effective_auth_mode(item, custom_auth_slugs=custom_auth_slugs)

    return ComposioApp(
        authMode=auth_mode,
        authSchemes=_normalize_auth_schemes(item),
        categories=_normalize_categories(meta.get("categories") or item.get("categories")),
        connectable=_toolkit_is_connectable(item, custom_auth_slugs=custom_auth_slugs),
        description=str(meta.get("description") or item.get("description") or ""),
        logoUrl=meta.get("logo") or item.get("logoUrl") or item.get("logo_url"),
        name=name,
        noAuth=bool(item.get("noAuth") or item.get("no_auth")),
        slug=slug,
        toolsCount=tools_count,
        triggersCount=triggers_count,
    )


def _tool_to_preview(item: dict[str, Any]) -> ComposioToolPreview:
    slug = str(item.get("slug") or item.get("name") or "")
    name = str(item.get("name") or slug.replace("_", " ").title())
    description = str(item.get("description") or item.get("display_description") or "")
    return ComposioToolPreview(description=description, name=name, slug=slug)


def _account_to_model(item: dict[str, Any]) -> ComposioConnectedAccount:
    toolkit = item.get("toolkit") if isinstance(item.get("toolkit"), dict) else {}
    auth_config = item.get("auth_config") if isinstance(item.get("auth_config"), dict) else {}
    auth_config_toolkit = auth_config.get("toolkit") if isinstance(auth_config.get("toolkit"), dict) else {}
    integration = item.get("integration") if isinstance(item.get("integration"), dict) else {}
    app = item.get("app") if isinstance(item.get("app"), dict) else {}
    state = item.get("state") if isinstance(item.get("state"), dict) else {}
    state_val = state.get("val") if isinstance(state.get("val"), dict) else {}

    return ComposioConnectedAccount(
        appSlug=str(
            toolkit.get("slug")
            or auth_config_toolkit.get("slug")
            or integration.get("slug")
            or app.get("slug")
            or item.get("toolkit_slug")
            or item.get("toolkitSlug")
            or item.get("appSlug")
            or item.get("app_slug")
            or "unknown"
        ),
        createdAt=item.get("createdAt") or item.get("created_at"),
        id=str(item.get("id") or ""),
        status=str(item.get("status") or state_val.get("status") or state.get("status") or "UNKNOWN"),
    )


def _normalize_categories(categories: Any) -> list[str]:
    if not isinstance(categories, list):
        return []

    values: list[str] = []
    for category in categories:
        if isinstance(category, str):
            values.append(category)
        elif isinstance(category, dict):
            value = category.get("name") or category.get("slug")
            if value:
                values.append(str(value))

    return values


def _int_or_none(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None
