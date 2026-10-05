"""Tavus conversation, training, and canvas callbacks."""

from __future__ import annotations

import hashlib
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import ensure_personal_workspace, now_iso
from app.models import NotepadNoteCreateRequest
from app.notepad import create_note
from app.tavus_knowledge import mark_document_status
from app.tavus_media import apply_ready_face, apply_ready_voice, mark_asset_error

router = APIRouter()


def add_minutes(user_id: str, minutes: int) -> None:
    return


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _conversation(token: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM tavus_conversations WHERE callback_token_hash = ?",
        (_hash(token),),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Unknown callback.")
    return row


def _save_transcript(conversation: dict[str, Any], transcript: list[Any]) -> str:
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (conversation["user_id"],))
    if not user:
        return ""
    lines = []
    for turn in transcript:
        if not isinstance(turn, dict):
            continue
        role = str(turn.get("role") or "user")
        content = str(turn.get("content") or "").strip()
        if content:
            lines.append(f"{role}: {content}")
    text = "\n".join(lines)
    workspace, profile, _runtime = ensure_personal_workspace(user)
    note = create_note(
        workspace,
        profile,
        NotepadNoteCreateRequest(
            title=f"Call {str(conversation['started_at'])[:16]}",
            content=text,
            transcript=text,
            summary=str(conversation.get("perception_summary") or ""),
            meeting_type=str(conversation.get("kind") or "general"),
            source="tavus",
        ),
    )
    db.execute(
        "UPDATE tavus_conversations SET notepad_note_id = ?, transcript_json = ? WHERE conversation_id = ?",
        (note.id, json.dumps(transcript), conversation["conversation_id"]),
    )
    return note.id


def handle_conversation_event(token: str, payload: dict[str, Any]) -> dict[str, str]:
    conversation = _conversation(token)
    event = str(payload.get("event_type") or "")
    props = payload.get("properties") if isinstance(payload.get("properties"), dict) else {}
    conversation_id = str(conversation["conversation_id"])
    if event in {"system.pal_joined", "system.replica_joined"}:
        db.execute(
            "UPDATE tavus_conversations SET status = 'live' WHERE conversation_id = ?",
            (conversation_id,),
        )
    elif event == "system.shutdown":
        ended = now_iso()
        started = str(conversation.get("started_at") or ended)
        minutes = 1
        try:
            from datetime import datetime

            delta = datetime.fromisoformat(ended.replace("Z", "+00:00")) - datetime.fromisoformat(
                started.replace("Z", "+00:00")
            )
            minutes = max(1, int(delta.total_seconds() // 60) or 1)
        except ValueError:
            minutes = 1
        db.execute(
            """
            UPDATE tavus_conversations
            SET status = 'ended', ended_at = ?, minutes_used = ?
            WHERE conversation_id = ?
            """,
            (ended, minutes, conversation_id),
        )
        add_minutes(str(conversation["user_id"]), minutes)
    elif event == "application.transcription_ready":
        transcript = props.get("transcript") if isinstance(props.get("transcript"), list) else []
        db.execute(
            "UPDATE tavus_conversations SET transcript_json = ? WHERE conversation_id = ?",
            (json.dumps(transcript), conversation_id),
        )
        fresh = db.fetch_one("SELECT * FROM tavus_conversations WHERE conversation_id = ?", (conversation_id,))
        if fresh:
            _save_transcript(fresh, transcript)
    elif event == "application.perception_analysis":
        summary = str(props.get("analysis") or "")
        db.execute(
            "UPDATE tavus_conversations SET perception_summary = ? WHERE conversation_id = ?",
            (summary, conversation_id),
        )
    return {"ok": "true"}


def handle_face_event(payload: dict[str, Any]) -> dict[str, str]:
    face_id = str(payload.get("face_id") or payload.get("replica_id") or "")
    if not face_id:
        return {"ok": "true"}
    status = str(payload.get("status") or "")
    asset = db.fetch_one("SELECT user_id FROM tavus_assets WHERE tavus_id = ? AND kind = 'face'", (face_id,))
    if not asset:
        return {"ok": "true"}
    if status in {"ready", "completed"}:
        apply_ready_face(str(asset["user_id"]), face_id)
    elif status == "error":
        mark_asset_error(face_id, str(payload.get("error_message") or "Face training failed."))
    return {"ok": "true"}


def handle_voice_event(payload: dict[str, Any]) -> dict[str, str]:
    props = payload.get("properties") if isinstance(payload.get("properties"), dict) else payload
    voice_id = str(props.get("voice_id") or payload.get("voice_id") or "")
    status = str(props.get("status") or payload.get("status") or "")
    if not voice_id:
        return {"ok": "true"}
    asset = db.fetch_one("SELECT user_id FROM tavus_assets WHERE tavus_id = ? AND kind = 'voice'", (voice_id,))
    if not asset:
        return {"ok": "true"}
    if status == "completed":
        apply_ready_voice(str(asset["user_id"]), voice_id)
    elif status == "error":
        mark_asset_error(voice_id, str(props.get("error_message") or "Voice training failed."))
    return {"ok": "true"}


def handle_video_event(payload: dict[str, Any]) -> dict[str, str]:
    video_id = str(payload.get("video_id") or "")
    if not video_id:
        return {"ok": "true"}
    status = str(payload.get("status") or "ready")
    url = str(payload.get("hosted_url") or payload.get("download_url") or "")
    db.execute(
        "UPDATE tavus_assets SET status = ?, name = ?, updated_at = ? WHERE kind = 'video' AND tavus_id = ?",
        (status, url or "Verxio message", now_iso(), video_id),
    )
    return {"ok": "true"}


@router.post("/api/tavus/webhooks/faces")
async def face_webhook_route(request: Request) -> dict[str, str]:
    payload = await request.json()
    return handle_face_event(payload if isinstance(payload, dict) else {})


@router.post("/api/tavus/webhooks/voices")
async def voice_webhook_route(request: Request) -> dict[str, str]:
    payload = await request.json()
    return handle_voice_event(payload if isinstance(payload, dict) else {})


@router.post("/api/tavus/webhooks/documents")
async def document_webhook_route(request: Request) -> dict[str, str]:
    payload = await request.json()
    if isinstance(payload, dict):
        document_id = str(payload.get("document_id") or "")
        status = str(payload.get("status") or "ready")
        if document_id:
            mark_document_status(document_id, status)
    return {"ok": "true"}


@router.post("/api/tavus/webhooks/videos")
async def video_webhook_route(request: Request) -> dict[str, str]:
    payload = await request.json()
    return handle_video_event(payload if isinstance(payload, dict) else {})


@router.post("/api/tavus/webhooks/{token}")
async def conversation_webhook_route(token: str, request: Request) -> dict[str, str]:
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Webhook payload must be an object.")
    return handle_conversation_event(token, payload)
