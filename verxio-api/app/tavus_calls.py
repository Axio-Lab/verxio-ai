"""Start and end a Tavus conversation. The desktop only receives the join URL."""

from __future__ import annotations

import hashlib
import json
import secrets
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.tavus_client import public_api_base, request as tavus_request
from app.tavus_profile import allow_test_mode, profile_row as _row

router = APIRouter()

def remaining_seconds(profile: dict[str, Any]) -> int:
    budget = int(profile.get("monthly_minute_budget") or 60)
    return max(budget, 1) * 60



def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def open_task_titles(user_id: str) -> list[str]:
    rows = db.fetch_all(
        """
        SELECT instruction FROM tavus_tasks
        WHERE user_id = ? AND status IN ('pending', 'claimed')
        ORDER BY created_at DESC LIMIT 5
        """,
        (user_id,),
    )
    return [str(row.get("instruction") or "") for row in rows]


def create_conversation(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    user_id = str(user["id"])
    profile = _row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before starting a call.")
    kind = str(payload.get("kind") or "app")
    if kind not in {"app", "meeting", "share"}:
        kind = "app"
    pal_id = str(profile["share_pal_id"] if kind == "share" and profile.get("share_pal_id") else profile["pal_id"])
    token = secrets.token_urlsafe(24)
    base = public_api_base()
    callback = f"{base}/api/tavus/webhooks/{token}" if base.startswith("https://") else ""
    titles = open_task_titles(user_id)
    context_bits = [f"The user's name is {profile.get('display_name') or user.get('name') or 'there'}."]
    if titles:
        context_bits.append("Open Verxio tasks: " + "; ".join(titles))
    body: dict[str, Any] = {
        "pal_id": pal_id,
        "participant_tags": [user_id],
        "conversational_context": " ".join(context_bits),
        "custom_greeting": f"Hi, I'm {profile.get('display_name') or 'Verxio'}.",
        "conversation_name": f"verxio-{user_id}-{kind}",
        "document_tags": [f"verxio-{user_id}"],
        "document_retrieval_strategy": "balanced",
        "require_auth": kind == "app",
        "properties": {
            "max_call_duration": remaining_seconds(profile),
            "participant_left_timeout": 30,
            "enable_closed_captions": True,
            "language": profile.get("language") or "en",
        },
    }
    if callback:
        body["callback_url"] = callback
    if payload.get("audioOnly"):
        body["audio_only"] = True
    meeting_url = str(payload.get("meetingUrl") or "").strip()
    if meeting_url:
        if not meeting_url.startswith("https://"):
            raise HTTPException(status_code=400, detail="Meeting links must be https.")
        body["meeting_url"] = meeting_url
        kind = "meeting"
    if str(profile.get("region") or "").lower() == "eu":
        body["policy"] = "eu"
    if payload.get("testMode") and allow_test_mode():
        body["test_mode"] = True
    created = tavus_request("POST", "/v2/conversations", json_body=body)
    conversation_id = str(created.get("conversation_id") or "")
    if not conversation_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a conversation.")
    now = now_iso()
    db.execute(
        """
        INSERT INTO tavus_conversations (
            conversation_id, user_id, kind, status, callback_token_hash, started_at, created_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?)
        """,
        (conversation_id, user_id, kind, _hash(token), now, now),
    )
    return {
        "conversationId": conversation_id,
        "conversationUrl": str(created.get("conversation_url") or ""),
        "meetingToken": str(created.get("meeting_token") or ""),
        "kind": kind,
    }


def end_conversation(user_id: str, conversation_id: str) -> dict[str, str]:
    row = db.fetch_one(
        "SELECT conversation_id FROM tavus_conversations WHERE conversation_id = ? AND user_id = ?",
        (conversation_id, user_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    tavus_request("POST", f"/v2/conversations/{conversation_id}/end")
    db.execute(
        "UPDATE tavus_conversations SET status = 'ended', ended_at = ? WHERE conversation_id = ?",
        (now_iso(), conversation_id),
    )
    return {"ok": "true"}


@router.post("/api/tavus/conversations")
async def create_conversation_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return create_conversation(user, payload)


@router.post("/api/tavus/conversations/{conversation_id}/end")
async def end_conversation_route(conversation_id: str, request: Request) -> dict[str, str]:
    user = await arequire_user_or_device(request)
    return end_conversation(str(user["id"]), conversation_id)


def list_history(user_id: str) -> dict[str, Any]:
    rows = db.fetch_all(
        """
        SELECT conversation_id, kind, status, started_at, ended_at, minutes_used,
               transcript_json, perception_summary, notepad_note_id
        FROM tavus_conversations WHERE user_id = ? ORDER BY created_at DESC LIMIT 50
        """,
        (user_id,),
    )
    calls = []
    for row in rows:
        try:
            transcript = json.loads(str(row.get("transcript_json") or "[]"))
        except json.JSONDecodeError:
            transcript = []
        calls.append(
            {
                "conversationId": row["conversation_id"],
                "kind": row["kind"],
                "status": row["status"],
                "startedAt": row["started_at"],
                "endedAt": row.get("ended_at"),
                "minutesUsed": row.get("minutes_used") or 0,
                "transcript": transcript if isinstance(transcript, list) else [],
                "perceptionSummary": row.get("perception_summary") or "",
                "notepadNoteId": row.get("notepad_note_id") or "",
            }
        )
    return {"calls": calls}
