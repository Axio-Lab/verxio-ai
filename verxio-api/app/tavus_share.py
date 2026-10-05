"""A shareable call link that cannot start Hermes work."""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.tavus_client import request as tavus_request
from app.tavus_profile import pal_body, profile_row, spoken_prompt

router = APIRouter()


def _share_pal(user_id: str, profile: dict[str, Any]) -> str:
    existing = str(profile.get("share_pal_id") or "")
    if existing:
        return existing
    prompt = spoken_prompt(
        str(profile.get("display_name") or "Verxio"),
        str(profile.get("tone") or ""),
        "Do not start tasks, touch Airtable, or use the owner's tools. This is a public conversation.",
    )
    body = pal_body(
        f"{user_id}-share",
        prompt,
        str(profile.get("face_id") or ""),
        str(profile.get("voice_id") or ""),
        with_tool=False,
    )
    body.pop("tool_ids", None)
    created = tavus_request("POST", "/v2/pals", json_body=body)
    pal_id = str(created.get("pal_id") or created.get("persona_id") or "")
    if not pal_id:
        raise HTTPException(status_code=502, detail="Tavus did not return a share PAL.")
    db.execute(
        "UPDATE tavus_profiles SET share_pal_id = ?, updated_at = ? WHERE user_id = ?",
        (pal_id, now_iso(), user_id),
    )
    return pal_id


def publish_share(user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id"):
        raise HTTPException(status_code=400, detail="Save a personality before sharing a link.")
    pal_id = _share_pal(user_id, profile)
    access = "auth_required" if payload.get("requireAuth") else "public"
    body: dict[str, Any] = {
        "pal_id": pal_id,
        "channel": "landing_page",
        "access": access,
        "call_limit": int(payload.get("callLimit") or 20),
    }
    password = str(payload.get("password") or "").strip()
    if password:
        body["password"] = password
    if payload.get("turnstile"):
        body["turnstile"] = True
    created = tavus_request("POST", "/v2/deployments", json_body=body)
    deployment_id = str(created.get("deployment_id") or "")
    url = str(created.get("url") or created.get("landing_page_url") or "")
    db.execute(
        "UPDATE tavus_profiles SET deployment_id = ?, share_url = ?, updated_at = ? WHERE user_id = ?",
        (deployment_id, url, now_iso(), user_id),
    )
    return {"deploymentId": deployment_id, "url": url}


def unpublish_share(user_id: str) -> dict[str, bool]:
    profile = profile_row(user_id)
    if not profile:
        return {"ok": True}
    deployment_id = str(profile.get("deployment_id") or "")
    if deployment_id:
        tavus_request("DELETE", f"/v2/deployments/{deployment_id}")
    db.execute(
        "UPDATE tavus_profiles SET deployment_id = NULL, share_url = '', updated_at = ? WHERE user_id = ?",
        (now_iso(), user_id),
    )
    return {"ok": True}


@router.post("/api/tavus/share")
async def publish_share_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        payload = {}
    return publish_share(str(user["id"]), payload)


@router.delete("/api/tavus/share")
async def unpublish_share_route(request: Request) -> dict[str, bool]:
    user = await arequire_user_or_device(request)
    return unpublish_share(str(user["id"]))
