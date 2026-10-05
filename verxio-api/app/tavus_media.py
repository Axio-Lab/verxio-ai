"""Train a face from a photo or video, and clone a voice, after the user consents."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.models import new_id
from app.tavus_client import public_api_base, request as tavus_request
from app.tavus_profile import profile_row

router = APIRouter()


def _require_consent(flag: bool) -> None:
    if not flag:
        raise HTTPException(status_code=400, detail="Confirm you have the rights to this likeness or voice.")


def _record_asset(user_id: str, kind: str, tavus_id: str, name: str) -> None:
    now = now_iso()
    db.execute(
        """
        INSERT INTO tavus_assets (id, user_id, kind, tavus_id, status, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'started', ?, ?, ?)
        """,
        (new_id("asset"), user_id, kind, tavus_id, name, now, now),
    )


def train_face(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    _require_consent(bool(payload.get("consent")))
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before training a face.")
    image = str(payload.get("imageUrl") or "").strip()
    video = str(payload.get("videoUrl") or "").strip()
    if bool(image) == bool(video):
        raise HTTPException(status_code=400, detail="Send either a photo URL or a video URL.")
    name = str(payload.get("name") or profile.get("display_name") or "Verxio")[:80]
    body: dict[str, Any] = {"face_name": name, "model_name": "phoenix-4.5"}
    base = public_api_base()
    if base.startswith("https://"):
        body["callback_url"] = f"{base}/api/tavus/webhooks/faces"
    if image:
        body["train_image_url"] = image
        body["auto_fix_training_image"] = True
        if payload.get("voiceId"):
            body["default_voice_id"] = str(payload["voiceId"])
        else:
            body["voice_name"] = str(payload.get("voiceName") or "anna")
    else:
        body["train_video_url"] = video
    created = tavus_request("POST", "/v2/faces", json_body=body)
    face_id = str(created.get("face_id") or created.get("replica_id") or "")
    if not face_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a face id.")
    _record_asset(user_id, "face", face_id, name)
    db.execute(
        "UPDATE tavus_profiles SET consent_face_at = ?, updated_at = ? WHERE user_id = ?",
        (now_iso(), now_iso(), user_id),
    )
    return {"faceId": face_id, "status": str(created.get("status") or "started")}


def train_voice(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    _require_consent(bool(payload.get("consent")))
    audio = str(payload.get("audioUrl") or "").strip()
    if not audio.startswith("https://"):
        raise HTTPException(status_code=400, detail="Voice samples must be a public https URL.")
    name = str(payload.get("name") or "My voice")[:80]
    body: dict[str, Any] = {"voice_name": name, "training_audio_url": audio}
    base = public_api_base()
    if base.startswith("https://"):
        body["callback_url"] = f"{base}/api/tavus/webhooks/voices"
    created = tavus_request("POST", "/v2/voices", json_body=body)
    voice_id = str(created.get("voice_id") or "")
    if not voice_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a voice id.")
    _record_asset(user_id, "voice", voice_id, name)
    db.execute(
        "UPDATE tavus_profiles SET consent_voice_at = ?, updated_at = ? WHERE user_id = ?",
        (now_iso(), now_iso(), user_id),
    )
    return {"voiceId": voice_id, "status": str(created.get("status") or "started")}


def apply_ready_face(user_id: str, face_id: str) -> None:
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        return
    tavus_request(
        "PATCH",
        f"/v2/pals/{profile['pal_id']}",
        json_body=[{"op": "replace", "path": "/default_face_id", "value": face_id}],
    )
    db.execute(
        "UPDATE tavus_profiles SET face_id = ?, updated_at = ? WHERE user_id = ?",
        (face_id, now_iso(), user_id),
    )
    db.execute(
        "UPDATE tavus_assets SET status = 'completed', updated_at = ? WHERE tavus_id = ? AND kind = 'face'",
        (now_iso(), face_id),
    )


def apply_ready_voice(user_id: str, voice_id: str) -> None:
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        return
    tavus_request(
        "PATCH",
        f"/v2/pals/{profile['pal_id']}",
        json_body=[{"op": "add", "path": "/layers/tts", "value": {"voice_id": voice_id}}],
    )
    db.execute(
        "UPDATE tavus_profiles SET voice_id = ?, updated_at = ? WHERE user_id = ?",
        (voice_id, now_iso(), user_id),
    )
    db.execute(
        "UPDATE tavus_assets SET status = 'completed', updated_at = ? WHERE tavus_id = ? AND kind = 'voice'",
        (now_iso(), voice_id),
    )


def mark_asset_error(tavus_id: str, message: str) -> None:
    db.execute(
        "UPDATE tavus_assets SET status = 'error', name = ?, updated_at = ? WHERE tavus_id = ?",
        (message[:180], now_iso(), tavus_id),
    )


@router.post("/api/tavus/faces")
async def train_face_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Face payload must be an object.")
    return train_face(str(user["id"]), payload)


@router.post("/api/tavus/voices")
async def train_voice_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Voice payload must be an object.")
    return train_voice(str(user["id"]), payload)


@router.get("/api/tavus/assets")
async def assets_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    rows = db.fetch_all(
        """
        SELECT id, kind, tavus_id, status, name FROM tavus_assets
        WHERE user_id = ? AND kind IN ('face', 'voice') ORDER BY created_at DESC
        """,
        (str(user["id"]),),
    )
    return {
        "assets": [
            {"id": row["id"], "kind": row["kind"], "tavusId": row["tavus_id"], "status": row["status"], "name": row["name"]}
            for row in rows
        ]
    }
