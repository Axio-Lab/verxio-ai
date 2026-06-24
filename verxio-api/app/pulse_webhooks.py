from __future__ import annotations

import hashlib
import hmac
import os
from typing import Any

from fastapi import BackgroundTasks, HTTPException, Request, Response

from app.models import PulseWebhookIngestResponse
from app.pulse import find_channel_by_external, mark_event_processed, record_event, resolve_channel_from_payload
from app.pulse_engine import process_inbound_message


def _webhook_verify_token() -> str:
    return os.getenv("META_WEBHOOK_VERIFY_TOKEN", "").strip() or os.getenv(
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN", ""
    ).strip()


def _meta_app_secret() -> str:
    return os.getenv("META_APP_SECRET", "").strip()


def verify_challenge(request: Request) -> Response:
    mode = request.query_params.get("hub.mode")
    token = request.query_params.get("hub.verify_token")
    challenge = request.query_params.get("hub.challenge")
    expected = _webhook_verify_token()
    if mode == "subscribe" and token and challenge and expected and hmac.compare_digest(token, expected):
        return Response(content=challenge, media_type="text/plain")
    raise HTTPException(status_code=403, detail="Webhook verification failed.")


def verify_meta_signature(raw_body: bytes, signature_header: str | None) -> bool:
    secret = _meta_app_secret()
    if not secret:
        return False
    if not signature_header or not signature_header.startswith("sha256="):
        return False
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(signature_header, expected)


def _entry_items(payload: dict[str, Any]) -> list[dict[str, Any]]:
    entries = payload.get("entry", [])
    return [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []


def _normalize_meta_messages(payload: dict[str, Any]) -> list[dict[str, str]]:
    channel_type = "instagram" if str(payload.get("object") or "").lower() == "instagram" else "messenger"
    messages: list[dict[str, str]] = []
    for entry in _entry_items(payload):
        page_id = str(entry.get("id") or "")
        for event in entry.get("messaging", []) if isinstance(entry.get("messaging"), list) else []:
            if not isinstance(event, dict):
                continue
            sender = event.get("sender", {}) if isinstance(event.get("sender"), dict) else {}
            message = event.get("message", {}) if isinstance(event.get("message"), dict) else {}
            postback = event.get("postback", {}) if isinstance(event.get("postback"), dict) else {}
            body = str(message.get("text") or postback.get("payload") or "").strip()
            if not body:
                continue
            messages.append(
                {
                    "channel_type": channel_type,
                    "channel_external_id": page_id,
                    "external_user_id": str(sender.get("id") or "unknown"),
                    "body": body,
                    "provider_message_id": str(message.get("mid") or postback.get("mid") or ""),
                    "username": "",
                    "display_name": "",
                }
            )
        for change in entry.get("changes", []) if isinstance(entry.get("changes"), list) else []:
            if not isinstance(change, dict):
                continue
            value = change.get("value", {}) if isinstance(change.get("value"), dict) else {}
            field = str(change.get("field") or "")
            if field not in {"comments", "live_comments", "messages"}:
                continue
            author = value.get("from", {}) if isinstance(value.get("from"), dict) else {}
            body = str(value.get("text") or value.get("message") or "").strip()
            if not body:
                continue
            messages.append(
                {
                    "channel_type": "instagram",
                    "channel_external_id": page_id,
                    "external_user_id": str(author.get("id") or value.get("from_id") or "unknown"),
                    "body": body,
                    "provider_message_id": str(value.get("id") or value.get("comment_id") or ""),
                    "username": str(author.get("username") or author.get("name") or ""),
                    "display_name": str(author.get("name") or author.get("username") or ""),
                }
            )
    return messages


def _normalize_whatsapp_messages(payload: dict[str, Any]) -> list[dict[str, str]]:
    messages: list[dict[str, str]] = []
    for entry in _entry_items(payload):
        for change in entry.get("changes", []) if isinstance(entry.get("changes"), list) else []:
            if not isinstance(change, dict):
                continue
            value = change.get("value", {}) if isinstance(change.get("value"), dict) else {}
            metadata = value.get("metadata", {}) if isinstance(value.get("metadata"), dict) else {}
            contacts = value.get("contacts", []) if isinstance(value.get("contacts"), list) else []
            names = {
                str(contact.get("wa_id") or ""): str((contact.get("profile") or {}).get("name") or "")
                for contact in contacts
                if isinstance(contact, dict)
            }
            for message in value.get("messages", []) if isinstance(value.get("messages"), list) else []:
                if not isinstance(message, dict):
                    continue
                text = message.get("text", {}) if isinstance(message.get("text"), dict) else {}
                interactive = message.get("interactive", {}) if isinstance(message.get("interactive"), dict) else {}
                button = interactive.get("button_reply", {}) if isinstance(interactive.get("button_reply"), dict) else {}
                body = str(text.get("body") or button.get("title") or "").strip()
                if not body:
                    continue
                sender = str(message.get("from") or "unknown")
                messages.append(
                    {
                        "channel_type": "whatsapp",
                        "channel_external_id": str(metadata.get("phone_number_id") or ""),
                        "external_user_id": sender,
                        "body": body,
                        "provider_message_id": str(message.get("id") or ""),
                        "username": sender,
                        "display_name": names.get(sender, sender),
                    }
                )
    return messages


async def _process_normalized_messages(
    event_id: str,
    payload: dict[str, Any],
    normalized: list[dict[str, str]],
    default_channel_type: str,
) -> None:
    error: str | None = None
    try:
        for item in normalized:
            channel_row = find_channel_by_external(
                item.get("channel_type") or default_channel_type,
                item.get("channel_external_id") or "",
            )
            if not channel_row:
                error = "No connected Pulse channel matched the webhook payload."
                continue
            await process_inbound_message(channel_row, item)
    except Exception as exc:  # keep webhook acknowledgements fast and provider-safe
        error = str(exc)
    mark_event_processed(event_id, error=error)


async def ingest_meta_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> PulseWebhookIngestResponse:
    raw_body = await request.body()
    signature_ok = verify_meta_signature(raw_body, request.headers.get("X-Hub-Signature-256"))
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be an object.")

    channel_type = "instagram" if str(payload.get("object") or "").lower() == "instagram" else "messenger"
    channel_row = resolve_channel_from_payload(channel_type, payload)
    event_id = record_event(
        channel_type=channel_type,
        payload=payload,
        signature_ok=signature_ok,
        channel_row=channel_row,
        provider_event_id=str(payload.get("object") or ""),
    )
    if not signature_ok:
        mark_event_processed(event_id, error="Invalid Meta webhook signature.")
        raise HTTPException(status_code=403, detail="Invalid Meta webhook signature.")

    normalized = _normalize_meta_messages(payload)
    background_tasks.add_task(_process_normalized_messages, event_id, payload, normalized, channel_type)
    return PulseWebhookIngestResponse(eventId=event_id, processed=False)


async def ingest_whatsapp_webhook(
    request: Request,
    background_tasks: BackgroundTasks,
) -> PulseWebhookIngestResponse:
    raw_body = await request.body()
    signature_ok = verify_meta_signature(raw_body, request.headers.get("X-Hub-Signature-256"))
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Invalid webhook JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be an object.")

    channel_row = resolve_channel_from_payload("whatsapp", payload)
    event_id = record_event(
        channel_type="whatsapp",
        payload=payload,
        signature_ok=signature_ok,
        channel_row=channel_row,
        provider_event_id=str(payload.get("object") or ""),
    )
    if not signature_ok:
        mark_event_processed(event_id, error="Invalid WhatsApp webhook signature.")
        raise HTTPException(status_code=403, detail="Invalid WhatsApp webhook signature.")

    normalized = _normalize_whatsapp_messages(payload)
    background_tasks.add_task(_process_normalized_messages, event_id, payload, normalized, "whatsapp")
    return PulseWebhookIngestResponse(eventId=event_id, processed=False)
