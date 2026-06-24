from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    PulseAnalyticsResponse,
    PulseAutomationCreateRequest,
    PulseAutomationGenerateRequest,
    PulseAutomationListResponse,
    PulseAutomationRecord,
    PulseAutomationSimulateResponse,
    PulseAutomationToggleRequest,
    PulseAutomationUpdateRequest,
    PulseChannelCapability,
    PulseChannelCapabilityMatrixItem,
    PulseChannelConnectRequest,
    PulseChannelConnectResponse,
    PulseChannelCreateRequest,
    PulseChannelRecord,
    PulseChannelsResponse,
    PulseChannelType,
    PulseContactRecord,
    PulseConversationDetailResponse,
    PulseConversationRecord,
    PulseConversationStateRequest,
    PulseConversationsResponse,
    PulseFlowDefinition,
    PulseFlowEdge,
    PulseFlowNode,
    PulseMetaOAuthCompleteRequest,
    PulseMetaOAuthCompleteResponse,
    PulseMessageRecord,
    PulseSendMessageRequest,
    PulseTagRecord,
    PulseTagsResponse,
    Workspace,
    new_id,
)


META_GRAPH_VERSION = os.getenv("META_GRAPH_VERSION", "v20.0").strip() or "v20.0"


def _json_loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return fallback


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _secret() -> bytes:
    raw = os.getenv("VERXIO_PULSE_SECRET", "").strip() or os.getenv(
        "VERXIO_AUTH_CODE_SECRET", ""
    ).strip()
    if not raw:
        raw = "verxio-local-pulse-development-secret"
    return hashlib.sha256(raw.encode("utf-8")).digest()


def _keystream(length: int, salt: bytes) -> bytes:
    output = bytearray()
    counter = 0
    key = _secret()
    while len(output) < length:
        output.extend(hmac.new(key, salt + counter.to_bytes(4, "big"), hashlib.sha256).digest())
        counter += 1
    return bytes(output[:length])


def encrypt_credentials(credentials: dict[str, str]) -> str:
    if not credentials:
        return ""
    plaintext = _json_dumps(credentials).encode("utf-8")
    salt = secrets.token_bytes(16)
    stream = _keystream(len(plaintext), salt)
    ciphertext = bytes(left ^ right for left, right in zip(plaintext, stream))
    tag = hmac.new(_secret(), salt + ciphertext, hashlib.sha256).digest()
    return base64.urlsafe_b64encode(salt + tag + ciphertext).decode("ascii")


def decrypt_credentials(value: str) -> dict[str, str]:
    if not value:
        return {}
    try:
        payload = base64.urlsafe_b64decode(value.encode("ascii"))
        salt, tag, ciphertext = payload[:16], payload[16:48], payload[48:]
        expected = hmac.new(_secret(), salt + ciphertext, hashlib.sha256).digest()
        if not hmac.compare_digest(tag, expected):
            raise ValueError("invalid credential tag")
        stream = _keystream(len(ciphertext), salt)
        plaintext = bytes(left ^ right for left, right in zip(ciphertext, stream))
        decoded = json.loads(plaintext.decode("utf-8"))
    except Exception as exc:
        raise HTTPException(status_code=500, detail="Pulse channel credentials could not be decrypted.") from exc
    return {str(key): str(value) for key, value in decoded.items()} if isinstance(decoded, dict) else {}


def channel_capability_matrix() -> list[PulseChannelCapabilityMatrixItem]:
    return [
        PulseChannelCapabilityMatrixItem(
            channel_type="instagram",
            name="Instagram",
            tier="first_class",
            description="Comments, DMs, story replies, and private replies through the Meta Graph API.",
            docsUrl="https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/messaging-api",
            capabilities=[
                PulseChannelCapability(key="comments", label="Comment triggers", supported=True),
                PulseChannelCapability(key="private_reply", label="Private replies", supported=True),
                PulseChannelCapability(key="dm_reply", label="DM replies", supported=True),
                PulseChannelCapability(key="ai_nodes", label="AI nodes", supported=True),
                PulseChannelCapability(key="broadcast", label="Broadcasts", supported=False, description="Policy-limited; not in MVP."),
            ],
        ),
        PulseChannelCapabilityMatrixItem(
            channel_type="messenger",
            name="Messenger",
            tier="first_class",
            description="Page messages and postbacks through the Messenger Platform Send API.",
            docsUrl="https://developers.facebook.com/docs/messenger-platform",
            capabilities=[
                PulseChannelCapability(key="dm_reply", label="Message replies", supported=True),
                PulseChannelCapability(key="postbacks", label="Postbacks", supported=True),
                PulseChannelCapability(key="ai_nodes", label="AI nodes", supported=True),
                PulseChannelCapability(key="outside_window", label="Outside-window tags", supported=False, description="Requires approved tags/templates."),
            ],
        ),
        PulseChannelCapabilityMatrixItem(
            channel_type="whatsapp",
            name="WhatsApp",
            tier="first_class",
            description="WhatsApp Business Cloud API messages and templates.",
            docsUrl="https://developers.facebook.com/docs/whatsapp/cloud-api",
            capabilities=[
                PulseChannelCapability(key="dm_reply", label="Message replies", supported=True),
                PulseChannelCapability(key="templates", label="Approved templates", supported=True),
                PulseChannelCapability(key="ai_nodes", label="AI nodes", supported=True),
                PulseChannelCapability(key="freeform_outside_window", label="Freeform outside 24h", supported=False),
            ],
        ),
        PulseChannelCapabilityMatrixItem(
            channel_type="tiktok",
            name="TikTok",
            tier="partner_gated",
            description="TikTok Business Messaging is region and partner gated; no unofficial browser automation.",
            docsUrl="https://business-api.tiktok.com/portal/docs?id=1736904327173121",
            capabilities=[
                PulseChannelCapability(key="business_messaging", label="Business messaging", supported=True, gated=True),
                PulseChannelCapability(key="comment_to_dm", label="Comment-to-DM", supported=False),
                PulseChannelCapability(key="ai_nodes", label="AI nodes", supported=True, gated=True),
            ],
        ),
        PulseChannelCapabilityMatrixItem(
            channel_type="linkedin",
            name="LinkedIn",
            tier="partner_gated",
            description="LinkedIn personal DMs are not publicly available; Page messaging requires approved APIs.",
            docsUrl="https://learn.microsoft.com/linkedin/marketing/",
            capabilities=[
                PulseChannelCapability(key="lead_sync", label="Lead sync", supported=True, gated=True),
                PulseChannelCapability(key="page_messaging", label="Page messaging", supported=True, gated=True),
                PulseChannelCapability(key="personal_dm", label="Personal DMs", supported=False),
            ],
        ),
    ]


def capabilities_for_channel(channel_type: PulseChannelType) -> dict[str, Any]:
    item = next((entry for entry in channel_capability_matrix() if entry.channel_type == channel_type), None)
    if not item:
        return {}
    return {
        "tier": item.tier,
        "docsUrl": item.docsUrl,
        "capabilities": [cap.model_dump() for cap in item.capabilities],
    }


def _channel_from_row(row: dict[str, Any]) -> PulseChannelRecord:
    payload = dict(row)
    payload["capabilities"] = _json_loads(payload.pop("capabilities_json", "{}"), {})
    payload.pop("credentials_encrypted", None)
    payload.pop("webhook_secret", None)
    return PulseChannelRecord(**payload)


def _contact_from_row(row: dict[str, Any], tags: list[str] | None = None) -> PulseContactRecord:
    payload = dict(row)
    payload["fields"] = _json_loads(payload.pop("fields_json", "{}"), {})
    payload["tags"] = tags or []
    return PulseContactRecord(**payload)


def _conversation_from_row(row: dict[str, Any]) -> PulseConversationRecord:
    return PulseConversationRecord(**row)


def _message_from_row(row: dict[str, Any]) -> PulseMessageRecord:
    payload = dict(row)
    payload["media"] = _json_loads(payload.pop("media_json", "[]"), [])
    return PulseMessageRecord(**payload)


def _automation_from_row(row: dict[str, Any]) -> PulseAutomationRecord:
    payload = dict(row)
    payload["enabled"] = bool(payload.get("enabled"))
    payload["flow"] = PulseFlowDefinition(**_json_loads(payload.pop("flow_json", "{}"), {}))
    return PulseAutomationRecord(**payload)


def list_channels(workspace: Workspace, profile: AgentProfile) -> PulseChannelsResponse:
    rows = db.fetch_all(
        """
        SELECT * FROM pulse_channels
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id),
    )
    return PulseChannelsResponse(
        channels=[_channel_from_row(row) for row in rows],
        capabilityMatrix=channel_capability_matrix(),
    )


def create_channel(
    workspace: Workspace,
    profile: AgentProfile,
    payload: PulseChannelCreateRequest,
    *,
    status: str = "connected",
) -> PulseChannelRecord:
    created_at = now_iso()
    channel_id = new_id("pulse_channel")
    capabilities = capabilities_for_channel(payload.channel_type)
    db.execute(
        """
        INSERT INTO pulse_channels (
            id, tenant_id, workspace_id, agent_id, channel_type, external_id, display_name,
            status, capabilities_json, credentials_encrypted, webhook_secret, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, agent_id, channel_type, external_id)
        DO UPDATE SET
            display_name = excluded.display_name,
            status = excluded.status,
            capabilities_json = excluded.capabilities_json,
            credentials_encrypted = excluded.credentials_encrypted,
            updated_at = excluded.updated_at
        """,
        (
            channel_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            payload.channel_type,
            payload.external_id.strip(),
            payload.display_name.strip(),
            status,
            _json_dumps(capabilities),
            encrypt_credentials(payload.credentials),
            secrets.token_urlsafe(24),
            created_at,
            created_at,
        ),
    )
    row = db.fetch_one(
        """
        SELECT * FROM pulse_channels
        WHERE workspace_id = ? AND agent_id = ? AND channel_type = ? AND external_id = ?
        """,
        (workspace.id, profile.id, payload.channel_type, payload.external_id.strip()),
    )
    assert row
    return _channel_from_row(row)


def connect_channel(
    workspace: Workspace,
    profile: AgentProfile,
    payload: PulseChannelConnectRequest,
) -> PulseChannelConnectResponse:
    if payload.channel_type in {"instagram", "messenger"}:
        app_id = os.getenv("META_APP_ID", "").strip()
        if not app_id:
            return PulseChannelConnectResponse(
                message="Meta app credentials are not configured. Add META_APP_ID and META_APP_SECRET first."
            )
        callback_url = payload.callbackUrl or os.getenv("VERXIO_PUBLIC_WEB_URL", "http://127.0.0.1:8080").rstrip(
            "/"
        )
        scopes = [
            "pages_show_list",
            "pages_messaging",
            "pages_manage_metadata",
            "instagram_basic",
            "instagram_manage_comments",
            "instagram_manage_messages",
        ]
        query = urlencode(
            {
                "client_id": app_id,
                "redirect_uri": callback_url,
                "scope": ",".join(scopes),
                "response_type": "code",
                "state": f"pulse:{workspace.id}:{profile.id}:{payload.channel_type}",
            }
        )
        return PulseChannelConnectResponse(
            redirectUrl=f"https://www.facebook.com/{META_GRAPH_VERSION}/dialog/oauth?{query}",
            message="Continue in Meta to connect the page or Instagram business account.",
        )

    if payload.channel_type == "whatsapp":
        external_id = payload.external_id or payload.credentials.get("phone_number_id") or payload.credentials.get("phoneNumberId")
        token = payload.credentials.get("access_token") or payload.credentials.get("accessToken")
        if not external_id or not token:
            raise HTTPException(status_code=400, detail="WhatsApp requires phone_number_id and access_token.")
        channel = create_channel(
            workspace,
            profile,
            PulseChannelCreateRequest(
                channel_type="whatsapp",
                external_id=external_id,
                display_name=payload.display_name or "WhatsApp Business",
                credentials=payload.credentials,
            ),
        )
        return PulseChannelConnectResponse(channel=channel, message="WhatsApp Cloud channel connected.")

    if payload.channel_type in {"tiktok", "linkedin"}:
        if not payload.external_id:
            return PulseChannelConnectResponse(
                message="This channel is partner-gated. Add approved API credentials when available."
            )
        channel = create_channel(
            workspace,
            profile,
            PulseChannelCreateRequest(
                channel_type=payload.channel_type,
                external_id=payload.external_id,
                display_name=payload.display_name or payload.channel_type.title(),
                credentials=payload.credentials,
            ),
            status="limited",
        )
        return PulseChannelConnectResponse(channel=channel, message="Limited channel saved with gated capabilities.")

    raise HTTPException(status_code=400, detail="Unsupported Pulse channel.")


async def complete_meta_oauth(
    workspace: Workspace,
    profile: AgentProfile,
    payload: PulseMetaOAuthCompleteRequest,
) -> PulseMetaOAuthCompleteResponse:
    app_id = os.getenv("META_APP_ID", "").strip()
    app_secret = os.getenv("META_APP_SECRET", "").strip()
    if not app_id or not app_secret:
        raise HTTPException(status_code=500, detail="Meta app credentials are not configured.")

    async with httpx.AsyncClient(timeout=30) as client:
        token_response = await client.get(
            f"https://graph.facebook.com/{META_GRAPH_VERSION}/oauth/access_token",
            params={
                "client_id": app_id,
                "client_secret": app_secret,
                "redirect_uri": payload.redirectUri,
                "code": payload.code,
            },
        )
        if token_response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Meta OAuth exchange failed: {token_response.text}")
        user_token = str(token_response.json().get("access_token") or "")
        if not user_token:
            raise HTTPException(status_code=502, detail="Meta OAuth did not return an access token.")

        pages_response = await client.get(
            f"https://graph.facebook.com/{META_GRAPH_VERSION}/me/accounts",
            params={
                "access_token": user_token,
                "fields": "id,name,access_token,connected_instagram_account{id,username,name}",
            },
        )
        if pages_response.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Meta pages lookup failed: {pages_response.text}")
        pages = pages_response.json().get("data", [])

    channels: list[PulseChannelRecord] = []
    for page in pages if isinstance(pages, list) else []:
        if not isinstance(page, dict):
            continue
        page_id = str(page.get("id") or "")
        page_token = str(page.get("access_token") or user_token)
        page_name = str(page.get("name") or "Meta Page")
        if payload.channel_type == "messenger" and page_id:
            channels.append(
                create_channel(
                    workspace,
                    profile,
                    PulseChannelCreateRequest(
                        channel_type="messenger",
                        external_id=page_id,
                        display_name=page_name,
                        credentials={"access_token": page_token, "page_access_token": page_token},
                    ),
                )
            )
        instagram = page.get("connected_instagram_account")
        if payload.channel_type == "instagram" and isinstance(instagram, dict):
            instagram_id = str(instagram.get("id") or "")
            if instagram_id:
                channels.append(
                    create_channel(
                        workspace,
                        profile,
                        PulseChannelCreateRequest(
                            channel_type="instagram",
                            external_id=instagram_id,
                            display_name=str(instagram.get("username") or instagram.get("name") or page_name),
                            credentials={
                                "access_token": page_token,
                                "page_access_token": page_token,
                                "page_id": page_id,
                            },
                        ),
                    )
                )
    if not channels:
        raise HTTPException(status_code=404, detail="No eligible Meta channels were found for this account.")
    return PulseMetaOAuthCompleteResponse(channels=channels, message="Meta channel connected.")


def delete_channel(workspace: Workspace, profile: AgentProfile, channel_id: str) -> dict[str, bool]:
    db.execute(
        """
        DELETE FROM pulse_channels
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (channel_id, workspace.id, profile.id),
    )
    return {"ok": True}


def _channel_row_by_external(channel_type: str, external_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        """
        SELECT * FROM pulse_channels
        WHERE channel_type = ? AND external_id = ?
        ORDER BY updated_at DESC
        LIMIT 1
        """,
        (channel_type, external_id),
    )


def find_channel_by_external(channel_type: str, external_id: str) -> dict[str, Any] | None:
    return _channel_row_by_external(channel_type, external_id)


def channel_credentials(channel_id: str) -> dict[str, str]:
    row = db.fetch_one("SELECT credentials_encrypted FROM pulse_channels WHERE id = ?", (channel_id,))
    if not row:
        raise HTTPException(status_code=404, detail="Pulse channel not found.")
    return decrypt_credentials(str(row.get("credentials_encrypted") or ""))


def list_conversations(workspace: Workspace, profile: AgentProfile) -> PulseConversationsResponse:
    rows = db.fetch_all(
        """
        SELECT c.*, ch.channel_type, ch.display_name AS channel_name, co.display_name AS contact_name,
            (
                SELECT body FROM pulse_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) AS last_message,
            0 AS unread
        FROM pulse_conversations c
        JOIN pulse_channels ch ON ch.id = c.channel_id
        JOIN pulse_contacts co ON co.id = c.contact_id
        WHERE c.workspace_id = ? AND c.agent_id = ?
        ORDER BY COALESCE(c.last_inbound_at, c.last_outbound_at, c.updated_at) DESC
        """,
        (workspace.id, profile.id),
    )
    return PulseConversationsResponse(conversations=[_conversation_from_row(row) for row in rows])


def _conversation_row(workspace: Workspace, profile: AgentProfile, conversation_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        """
        SELECT c.*, ch.channel_type, ch.display_name AS channel_name, co.display_name AS contact_name,
            (
                SELECT body FROM pulse_messages m
                WHERE m.conversation_id = c.id
                ORDER BY m.created_at DESC
                LIMIT 1
            ) AS last_message,
            0 AS unread
        FROM pulse_conversations c
        JOIN pulse_channels ch ON ch.id = c.channel_id
        JOIN pulse_contacts co ON co.id = c.contact_id
        WHERE c.id = ? AND c.workspace_id = ? AND c.agent_id = ?
        """,
        (conversation_id, workspace.id, profile.id),
    )


def get_conversation_detail(
    workspace: Workspace,
    profile: AgentProfile,
    conversation_id: str,
) -> PulseConversationDetailResponse:
    conversation_row = _conversation_row(workspace, profile, conversation_id)
    if not conversation_row:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    contact_row = db.fetch_one(
        """
        SELECT co.* FROM pulse_contacts co
        JOIN pulse_conversations c ON c.contact_id = co.id
        WHERE c.id = ? AND c.workspace_id = ? AND c.agent_id = ?
        """,
        (conversation_id, workspace.id, profile.id),
    )
    assert contact_row
    messages = db.fetch_all(
        """
        SELECT * FROM pulse_messages
        WHERE conversation_id = ? AND workspace_id = ? AND agent_id = ?
        ORDER BY created_at ASC
        """,
        (conversation_id, workspace.id, profile.id),
    )
    return PulseConversationDetailResponse(
        conversation=_conversation_from_row(conversation_row),
        contact=_contact_from_row(contact_row, tags=_contact_tags(contact_row["id"])),
        messages=[_message_from_row(row) for row in messages],
    )


def add_message(
    workspace: Workspace,
    profile: AgentProfile,
    conversation_id: str,
    direction: str,
    body: str,
    *,
    status: str = "sent",
    provider_message_id: str | None = None,
    media: list[dict[str, Any]] | None = None,
) -> PulseMessageRecord:
    if not _conversation_row(workspace, profile, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    created_at = now_iso()
    message_id = new_id("pulse_msg")
    db.execute(
        """
        INSERT INTO pulse_messages (
            id, tenant_id, workspace_id, agent_id, conversation_id, direction, body,
            media_json, provider_message_id, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            message_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            conversation_id,
            direction,
            body,
            _json_dumps(media or []),
            provider_message_id,
            status,
            created_at,
            created_at,
        ),
    )
    timestamp_field = "last_outbound_at" if direction == "outbound" else "last_inbound_at"
    db.execute(
        f"""
        UPDATE pulse_conversations
        SET {timestamp_field} = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (created_at, created_at, conversation_id, workspace.id, profile.id),
    )
    row = db.fetch_one("SELECT * FROM pulse_messages WHERE id = ?", (message_id,))
    assert row
    return _message_from_row(row)


def update_conversation_state(
    workspace: Workspace,
    profile: AgentProfile,
    conversation_id: str,
    payload: PulseConversationStateRequest,
) -> PulseConversationRecord:
    if not _conversation_row(workspace, profile, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found.")
    db.execute(
        """
        UPDATE pulse_conversations
        SET state = ?, updated_at = ?
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (payload.state, now_iso(), conversation_id, workspace.id, profile.id),
    )
    row = _conversation_row(workspace, profile, conversation_id)
    assert row
    return _conversation_from_row(row)


def list_automations(workspace: Workspace, profile: AgentProfile) -> PulseAutomationListResponse:
    rows = db.fetch_all(
        """
        SELECT * FROM pulse_automations
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC
        """,
        (workspace.id, profile.id),
    )
    return PulseAutomationListResponse(automations=[_automation_from_row(row) for row in rows])


def _automation_row(workspace: Workspace, profile: AgentProfile, automation_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        """
        SELECT * FROM pulse_automations
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (automation_id, workspace.id, profile.id),
    )


def create_automation(
    workspace: Workspace,
    profile: AgentProfile,
    payload: PulseAutomationCreateRequest,
) -> PulseAutomationRecord:
    created_at = now_iso()
    automation_id = new_id("pulse_auto")
    flow = payload.flow.model_dump()
    if not flow.get("nodes"):
        flow = default_flow(payload.channel_type).model_dump()
    db.execute(
        """
        INSERT INTO pulse_automations (
            id, tenant_id, workspace_id, agent_id, name, channel_type, enabled,
            flow_json, version, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        """,
        (
            automation_id,
            workspace.tenant_id,
            workspace.id,
            profile.id,
            payload.name.strip(),
            payload.channel_type,
            1 if payload.enabled else 0,
            _json_dumps(flow),
            created_at,
            created_at,
        ),
    )
    row = _automation_row(workspace, profile, automation_id)
    assert row
    return _automation_from_row(row)


def update_automation(
    workspace: Workspace,
    profile: AgentProfile,
    automation_id: str,
    payload: PulseAutomationUpdateRequest,
) -> PulseAutomationRecord:
    row = _automation_row(workspace, profile, automation_id)
    if not row:
        raise HTTPException(status_code=404, detail="Automation not found.")
    updates = payload.model_dump(exclude_unset=True)
    if not updates:
        return _automation_from_row(row)

    fields: list[str] = []
    params: list[Any] = []
    if updates.get("name") is not None:
        fields.append("name = ?")
        params.append(str(updates["name"]).strip())
    if updates.get("channel_type") is not None:
        fields.append("channel_type = ?")
        params.append(updates["channel_type"])
    if updates.get("enabled") is not None:
        fields.append("enabled = ?")
        params.append(1 if updates["enabled"] else 0)
    if updates.get("flow") is not None:
        flow = updates["flow"]
        fields.append("flow_json = ?")
        params.append(_json_dumps(flow.model_dump() if hasattr(flow, "model_dump") else flow))
        fields.append("version = version + 1")
    fields.append("updated_at = ?")
    params.extend([now_iso(), automation_id, workspace.id, profile.id])
    db.execute(
        f"""
        UPDATE pulse_automations
        SET {", ".join(fields)}
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        params,
    )
    updated = _automation_row(workspace, profile, automation_id)
    assert updated
    return _automation_from_row(updated)


def toggle_automation(
    workspace: Workspace,
    profile: AgentProfile,
    automation_id: str,
    payload: PulseAutomationToggleRequest,
) -> PulseAutomationRecord:
    return update_automation(
        workspace,
        profile,
        automation_id,
        PulseAutomationUpdateRequest(enabled=payload.enabled),
    )


def delete_automation(workspace: Workspace, profile: AgentProfile, automation_id: str) -> dict[str, bool]:
    db.execute(
        """
        DELETE FROM pulse_automations
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (automation_id, workspace.id, profile.id),
    )
    return {"ok": True}


def default_flow(channel_type: PulseChannelType = "instagram") -> PulseFlowDefinition:
    return PulseFlowDefinition(
        nodes=[
            PulseFlowNode(
                id="trigger-1",
                kind="trigger",
                label="Keyword trigger",
                config={"trigger": "comment_keyword", "keywords": ["info", "price", "demo"]},
            ),
            PulseFlowNode(
                id="ai-1",
                kind="ai_reply",
                label="Qualify and reply",
                config={
                    "goal": "Answer the lead in a concise, branded way and decide whether to hand off.",
                    "allowComposio": True,
                },
            ),
            PulseFlowNode(id="tag-1", kind="set_tag", label="Tag lead", config={"tag": "pulse-lead"}),
            PulseFlowNode(id="end-1", kind="end", label="Done"),
        ],
        edges=[
            PulseFlowEdge(id="edge-1", source="trigger-1", target="ai-1"),
            PulseFlowEdge(id="edge-2", source="ai-1", target="tag-1"),
            PulseFlowEdge(id="edge-3", source="tag-1", target="end-1"),
        ],
    )


def generated_flow_from_prompt(payload: PulseAutomationGenerateRequest) -> PulseAutomationRecord:
    now = now_iso()
    name = payload.prompt.strip().splitlines()[0][:72] or "Generated Pulse automation"
    flow = default_flow(payload.channel_type)
    flow.nodes[1].config["goal"] = payload.prompt.strip()
    return PulseAutomationRecord(
        id="generated",
        tenant_id="preview",
        workspace_id="preview",
        agent_id="preview",
        name=name,
        channel_type=payload.channel_type,
        enabled=False,
        flow=flow,
        version=1,
        created_at=now,
        updated_at=now,
    )


def simulate_automation(
    workspace: Workspace,
    profile: AgentProfile,
    payload: PulseAutomationSimulateRequest,
) -> PulseAutomationSimulateResponse:
    flow = payload.flow
    if not flow and payload.automation_id:
        row = _automation_row(workspace, profile, payload.automation_id)
        if not row:
            raise HTTPException(status_code=404, detail="Automation not found.")
        flow = _automation_from_row(row).flow
    flow = flow or default_flow()
    now = now_iso()
    transcript = [
        PulseMessageRecord(
            id="sim_inbound",
            tenant_id=workspace.tenant_id,
            workspace_id=workspace.id,
            agent_id=profile.id,
            conversation_id="simulation",
            direction="inbound",
            body=payload.message,
            status="received",
            created_at=now,
            updated_at=now,
        ),
        PulseMessageRecord(
            id="sim_outbound",
            tenant_id=workspace.tenant_id,
            workspace_id=workspace.id,
            agent_id=profile.id,
            conversation_id="simulation",
            direction="outbound",
            body="Thanks for reaching out. Pulse would route this through the configured flow and AI node.",
            status="simulated",
            created_at=now,
            updated_at=now,
        ),
    ]
    return PulseAutomationSimulateResponse(
        transcript=transcript,
        context={"nodes": [node.model_dump() for node in flow.nodes], "edges": [edge.model_dump() for edge in flow.edges]},
    )


def _contact_tags(contact_id: str) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT t.name
        FROM pulse_tags t
        JOIN pulse_contact_tags ct ON ct.tag_id = t.id
        WHERE ct.contact_id = ?
        ORDER BY t.name ASC
        """,
        (contact_id,),
    )
    return [str(row["name"]) for row in rows]


def ensure_tag(workspace: Workspace, profile: AgentProfile, name: str, color: str = "primary") -> PulseTagRecord:
    tag_name = name.strip()
    existing = db.fetch_one(
        """
        SELECT * FROM pulse_tags
        WHERE workspace_id = ? AND agent_id = ? AND name = ?
        """,
        (workspace.id, profile.id, tag_name),
    )
    if existing:
        return PulseTagRecord(**existing)
    created_at = now_iso()
    tag_id = new_id("pulse_tag")
    db.execute(
        """
        INSERT INTO pulse_tags (id, tenant_id, workspace_id, agent_id, name, color, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (tag_id, workspace.tenant_id, workspace.id, profile.id, tag_name, color, created_at, created_at),
    )
    row = db.fetch_one("SELECT * FROM pulse_tags WHERE id = ?", (tag_id,))
    assert row
    return PulseTagRecord(**row)


def add_contact_tag(workspace: Workspace, profile: AgentProfile, contact_id: str, name: str) -> None:
    tag = ensure_tag(workspace, profile, name)
    db.execute(
        """
        INSERT OR IGNORE INTO pulse_contact_tags (contact_id, tag_id, created_at)
        VALUES (?, ?, ?)
        """,
        (contact_id, tag.id, now_iso()),
    )


def list_tags(workspace: Workspace, profile: AgentProfile) -> PulseTagsResponse:
    rows = db.fetch_all(
        """
        SELECT * FROM pulse_tags
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY name ASC
        """,
        (workspace.id, profile.id),
    )
    return PulseTagsResponse(tags=[PulseTagRecord(**row) for row in rows])


def analytics(workspace: Workspace, profile: AgentProfile) -> PulseAnalyticsResponse:
    totals = {
        "channels": int(
            db.fetch_one(
                "SELECT COUNT(*) AS count FROM pulse_channels WHERE workspace_id = ? AND agent_id = ?",
                (workspace.id, profile.id),
            )["count"]
        ),
        "contacts": int(
            db.fetch_one(
                "SELECT COUNT(*) AS count FROM pulse_contacts WHERE workspace_id = ? AND agent_id = ?",
                (workspace.id, profile.id),
            )["count"]
        ),
        "conversations": int(
            db.fetch_one(
                "SELECT COUNT(*) AS count FROM pulse_conversations WHERE workspace_id = ? AND agent_id = ?",
                (workspace.id, profile.id),
            )["count"]
        ),
        "automations": int(
            db.fetch_one(
                "SELECT COUNT(*) AS count FROM pulse_automations WHERE workspace_id = ? AND agent_id = ?",
                (workspace.id, profile.id),
            )["count"]
        ),
    }
    breakdown = db.fetch_all(
        """
        SELECT channel_type, COUNT(*) AS conversations
        FROM pulse_conversations c
        JOIN pulse_channels ch ON ch.id = c.channel_id
        WHERE c.workspace_id = ? AND c.agent_id = ?
        GROUP BY channel_type
        ORDER BY conversations DESC
        """,
        (workspace.id, profile.id),
    )
    recent_runs = db.fetch_all(
        """
        SELECT id, automation_id, status, updated_at, error
        FROM pulse_runs
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC
        LIMIT 10
        """,
        (workspace.id, profile.id),
    )
    return PulseAnalyticsResponse(
        totals=totals,
        channelBreakdown=[dict(row) for row in breakdown],
        recentRuns=[dict(row) for row in recent_runs],
    )


def record_event(
    *,
    channel_type: str,
    payload: dict[str, Any],
    signature_ok: bool,
    channel_row: dict[str, Any] | None = None,
    provider_event_id: str | None = None,
    processed: bool = False,
    error: str | None = None,
) -> str:
    created_at = now_iso()
    event_id = new_id("pulse_evt")
    db.execute(
        """
        INSERT INTO pulse_events (
            id, tenant_id, workspace_id, agent_id, channel_id, channel_type, provider_event_id,
            signature_ok, processed, payload_json, error, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            event_id,
            channel_row.get("tenant_id") if channel_row else None,
            channel_row.get("workspace_id") if channel_row else None,
            channel_row.get("agent_id") if channel_row else None,
            channel_row.get("id") if channel_row else None,
            channel_type,
            provider_event_id,
            1 if signature_ok else 0,
            1 if processed else 0,
            _json_dumps(payload),
            error,
            created_at,
            created_at,
        ),
    )
    return event_id


def mark_event_processed(event_id: str, *, error: str | None = None) -> None:
    db.execute(
        """
        UPDATE pulse_events
        SET processed = ?, error = ?, updated_at = ?
        WHERE id = ?
        """,
        (0 if error else 1, error, now_iso(), event_id),
    )


def resolve_channel_from_payload(channel_type: str, payload: dict[str, Any]) -> dict[str, Any] | None:
    external_ids: list[str] = []
    if channel_type in {"instagram", "messenger"}:
        for entry in payload.get("entry", []) if isinstance(payload.get("entry"), list) else []:
            if isinstance(entry, dict):
                external_ids.append(str(entry.get("id") or ""))
    elif channel_type == "whatsapp":
        for entry in payload.get("entry", []) if isinstance(payload.get("entry"), list) else []:
            for change in entry.get("changes", []) if isinstance(entry, dict) else []:
                value = change.get("value", {}) if isinstance(change, dict) else {}
                metadata = value.get("metadata", {}) if isinstance(value, dict) else {}
                external_ids.append(str(metadata.get("phone_number_id") or ""))
    for external_id in [item for item in external_ids if item]:
        row = _channel_row_by_external(channel_type, external_id)
        if row:
            return row
    return None


def upsert_inbound_message(
    channel_row: dict[str, Any],
    *,
    external_user_id: str,
    body: str,
    provider_message_id: str | None = None,
    username: str | None = None,
    display_name: str | None = None,
) -> tuple[Workspace, AgentProfile, PulseConversationRecord, PulseMessageRecord]:
    workspace = Workspace(
        id=str(channel_row["workspace_id"]),
        tenant_id=str(channel_row["tenant_id"]),
        name="Pulse workspace",
        region="Hosted",
        plan="Hermes runtime workspace",
    )
    profile = AgentProfile(
        id=str(channel_row["agent_id"]),
        tenant_id=str(channel_row["tenant_id"]),
        workspace_id=str(channel_row["workspace_id"]),
        name="Verxio Agent",
        role="AI agent",
        status="active",
        description="Pulse automation agent",
        capabilities=[],
        starters=[],
    )
    created_at = now_iso()
    contact_row = db.fetch_one(
        """
        SELECT * FROM pulse_contacts
        WHERE channel_id = ? AND external_user_id = ?
        """,
        (channel_row["id"], external_user_id),
    )
    if not contact_row:
        contact_id = new_id("pulse_contact")
        db.execute(
            """
            INSERT INTO pulse_contacts (
                id, tenant_id, workspace_id, agent_id, channel_id, external_user_id,
                username, display_name, fields_json, consent_state, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 'unknown', ?, ?)
            """,
            (
                contact_id,
                channel_row["tenant_id"],
                channel_row["workspace_id"],
                channel_row["agent_id"],
                channel_row["id"],
                external_user_id,
                username,
                display_name or username or external_user_id,
                created_at,
                created_at,
            ),
        )
        contact_row = db.fetch_one("SELECT * FROM pulse_contacts WHERE id = ?", (contact_id,))
    assert contact_row

    conversation_row = db.fetch_one(
        """
        SELECT * FROM pulse_conversations
        WHERE channel_id = ? AND contact_id = ?
        """,
        (channel_row["id"], contact_row["id"]),
    )
    window_expires_at = (datetime.now(timezone.utc) + timedelta(hours=24)).isoformat()
    if not conversation_row:
        conversation_id = new_id("pulse_conv")
        db.execute(
            """
            INSERT INTO pulse_conversations (
                id, tenant_id, workspace_id, agent_id, channel_id, contact_id, state,
                window_expires_at, last_inbound_at, created_at, updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, 'automated', ?, ?, ?, ?)
            """,
            (
                conversation_id,
                channel_row["tenant_id"],
                channel_row["workspace_id"],
                channel_row["agent_id"],
                channel_row["id"],
                contact_row["id"],
                window_expires_at,
                created_at,
                created_at,
                created_at,
            ),
        )
    else:
        conversation_id = str(conversation_row["id"])
        db.execute(
            """
            UPDATE pulse_conversations
            SET last_inbound_at = ?, window_expires_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (created_at, window_expires_at, created_at, conversation_id),
        )
    message = add_message(
        workspace,
        profile,
        conversation_id,
        "inbound",
        body,
        status="received",
        provider_message_id=provider_message_id,
    )
    conversation = _conversation_row(workspace, profile, conversation_id)
    assert conversation
    return workspace, profile, _conversation_from_row(conversation), message


def send_human_message(
    workspace: Workspace,
    profile: AgentProfile,
    conversation_id: str,
    payload: PulseSendMessageRequest,
) -> PulseMessageRecord:
    return add_message(workspace, profile, conversation_id, "outbound", payload.body, status="queued")
