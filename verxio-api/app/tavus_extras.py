"""Video messages, pronunciation, and call history."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.models import new_id
from app.tavus_calls import list_history
from app.tavus_client import public_api_base, request as tavus_request
from app.tavus_profile import profile_row

router = APIRouter()


def create_video(user_id: str, script: str) -> dict[str, Any]:
    profile = profile_row(user_id)
    if not profile or not profile.get("face_id"):
        raise HTTPException(status_code=400, detail="A trained or stock face is required before recording a video.")
    text = script.strip()
    if not text:
        raise HTTPException(status_code=400, detail="The video needs a script.")
    body: dict[str, Any] = {"face_id": profile["face_id"], "script": text[:4000], "video_name": "Verxio message"}
    base = public_api_base()
    if base.startswith("https://"):
        body["callback_url"] = f"{base}/api/tavus/webhooks/videos"
    created = tavus_request("POST", "/v2/videos", json_body=body)
    video_id = str(created.get("video_id") or "")
    if video_id:
        now = now_iso()
        db.execute(
            """
            INSERT INTO tavus_assets (id, user_id, kind, tavus_id, status, name, created_at, updated_at)
            VALUES (?, ?, 'video', ?, ?, ?, ?, ?)
            """,
            (
                new_id("asset"),
                user_id,
                video_id,
                str(created.get("status") or "started"),
                str(created.get("hosted_url") or "Verxio message"),
                now,
                now,
            ),
        )
    return {
        "videoId": video_id,
        "status": str(created.get("status") or "started"),
        "hostedUrl": str(created.get("hosted_url") or ""),
    }


def save_pronunciation(user_id: str, rules: list[dict[str, Any]]) -> dict[str, Any]:
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before adding pronunciation.")
    cleaned = []
    for rule in rules[:40]:
        word = str(rule.get("word") or "").strip()
        pronunciation = str(rule.get("pronunciation") or "").strip()
        if word and pronunciation:
            cleaned.append({"word": word, "pronunciation": pronunciation})
    dictionary_id = str(profile.get("pronunciation_dictionary_id") or "")
    if dictionary_id:
        tavus_request(
            "PATCH",
            f"/v2/pronunciation-dictionaries/{dictionary_id}",
            json_body=[{"op": "replace", "path": "/rules", "value": cleaned}],
        )
    else:
        created = tavus_request(
            "POST",
            "/v2/pronunciation-dictionaries",
            json_body={"name": f"verxio-{user_id}"[:40], "rules": cleaned},
        )
        dictionary_id = str(created.get("pronunciation_dictionary_id") or created.get("id") or "")
        from app import db
        from app.control_plane import now_iso

        db.execute(
            "UPDATE tavus_profiles SET pronunciation_dictionary_id = ?, updated_at = ? WHERE user_id = ?",
            (dictionary_id, now_iso(), user_id),
        )
        if dictionary_id:
            tavus_request(
                "PATCH",
                f"/v2/pals/{profile['pal_id']}",
                json_body=[
                    {"op": "add", "path": "/pronunciation_dictionary_id", "value": dictionary_id}
                ],
            )
    return {"dictionaryId": dictionary_id, "rules": cleaned}


@router.get("/api/tavus/calls")
async def calls_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    return list_history(str(user["id"]))


@router.post("/api/tavus/videos")
async def video_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    script = str((payload or {}).get("script") or "") if isinstance(payload, dict) else ""
    return create_video(str(user["id"]), script)


@router.put("/api/tavus/pronunciation")
async def pronunciation_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    rules = payload.get("rules") if isinstance(payload, dict) else []
    if not isinstance(rules, list):
        rules = []
    return save_pronunciation(str(user["id"]), rules)
