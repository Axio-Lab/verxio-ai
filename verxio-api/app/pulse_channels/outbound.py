from __future__ import annotations

from typing import Any

import httpx
from fastapi import HTTPException

from app.pulse import META_GRAPH_VERSION, channel_credentials


async def send_channel_message(
    channel_row: dict[str, Any],
    recipient_id: str,
    body: str,
    *,
    comment_id: str | None = None,
) -> str | None:
    channel_type = str(channel_row.get("channel_type") or "")
    if channel_type in {"instagram", "messenger"}:
        return await _send_meta_message(channel_row, recipient_id, body, comment_id=comment_id)
    if channel_type == "whatsapp":
        return await _send_whatsapp_message(channel_row, recipient_id, body)
    if channel_type in {"tiktok", "linkedin"}:
        raise HTTPException(status_code=409, detail=f"{channel_type.title()} outbound messaging is partner-gated.")
    raise HTTPException(status_code=400, detail="Unsupported Pulse channel.")


async def _send_meta_message(
    channel_row: dict[str, Any],
    recipient_id: str,
    body: str,
    *,
    comment_id: str | None,
) -> str | None:
    credentials = channel_credentials(str(channel_row["id"]))
    access_token = credentials.get("access_token") or credentials.get("page_access_token")
    if not access_token:
        raise HTTPException(status_code=409, detail="Meta channel is missing an access token.")
    sender_id = str(channel_row.get("external_id") or "")
    recipient = {"comment_id": comment_id} if comment_id else {"id": recipient_id}
    payload = {
        "recipient": recipient,
        "message": {"text": body},
        "messaging_type": "RESPONSE",
        "access_token": access_token,
    }
    url = f"https://graph.facebook.com/{META_GRAPH_VERSION}/{sender_id}/messages"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, json=payload)
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Meta send failed: {response.text}")
    data = response.json()
    return str(data.get("message_id") or data.get("id") or "")


async def _send_whatsapp_message(channel_row: dict[str, Any], recipient_id: str, body: str) -> str | None:
    credentials = channel_credentials(str(channel_row["id"]))
    access_token = credentials.get("access_token") or credentials.get("token")
    phone_number_id = credentials.get("phone_number_id") or str(channel_row.get("external_id") or "")
    if not access_token or not phone_number_id:
        raise HTTPException(status_code=409, detail="WhatsApp channel is missing phone_number_id or access_token.")
    payload = {
        "messaging_product": "whatsapp",
        "to": recipient_id,
        "type": "text",
        "text": {"preview_url": False, "body": body},
    }
    url = f"https://graph.facebook.com/{META_GRAPH_VERSION}/{phone_number_id}/messages"
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(url, json=payload, headers={"Authorization": f"Bearer {access_token}"})
    if response.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"WhatsApp send failed: {response.text}")
    data = response.json()
    messages = data.get("messages") if isinstance(data, dict) else None
    if isinstance(messages, list) and messages:
        first = messages[0]
        if isinstance(first, dict):
            return str(first.get("id") or "")
    return str(data.get("id") or "")
