"""Meet, Zoom, and Teams identity for a user's PAL."""

from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.tavus_client import request as tavus_request
from app.tavus_profile import profile_row

router = APIRouter()

USERNAME = re.compile(r"^[a-z0-9](?:[a-z0-9._-]{0,30}[a-z0-9])?$")


def normalize_username(raw: str) -> str:
    slug = re.sub(r"[^a-z0-9._-]+", "-", raw.strip().lower())
    slug = slug.strip(".-_")
    if not slug.startswith("verxio-"):
        slug = f"verxio-{slug}" if slug else "verxio-agent"
    if re.fullmatch(r"bot\d+", slug):
        slug = f"verxio-{slug}"
    if not USERNAME.match(slug) or len(slug) < 2:
        raise HTTPException(status_code=400, detail="Use letters, numbers, dots, or dashes.")
    return slug[:32]


def check_username(username: str) -> dict[str, Any]:
    slug = normalize_username(username)
    payload = tavus_request("GET", f"/v2/pals/check-username?username={slug}")
    available = bool(payload.get("available", True))
    return {"username": slug, "available": available, "email": f"{slug}@tavusinvite.com"}


def save_meeting_identity(user: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    user_id = str(user["id"])
    profile = profile_row(user_id)
    if not profile or not profile.get("pal_id") or not profile.get("face_id"):
        raise HTTPException(status_code=400, detail="Save a personality and a face before enabling meetings.")
    slug = normalize_username(str(payload.get("username") or ""))
    checked = check_username(slug)
    current = str(profile.get("conferencing_username") or "")
    if not checked["available"] and slug != current:
        raise HTTPException(status_code=409, detail="That meeting name is already taken.")
    allow = payload.get("allowlist")
    if not isinstance(allow, list) or not allow:
        allow = [str(user.get("email") or "")]
    emails = [str(item).strip() for item in allow if str(item).strip()]
    tavus_request(
        "PATCH",
        f"/v2/pals/{profile['pal_id']}",
        json_body=[
            {
                "op": "add",
                "path": "/layers/conferencing",
                "value": {"username": slug, "allowlist": emails},
            }
        ],
    )
    db.execute(
        """
        UPDATE tavus_profiles
        SET conferencing_username = ?, meeting_allowlist = ?, updated_at = ?
        WHERE user_id = ?
        """,
        (slug, json.dumps(emails), now_iso(), user_id),
    )
    return {"username": slug, "email": f"{slug}@tavusinvite.com", "allowlist": emails}


@router.get("/api/tavus/meetings/username")
async def check_username_route(username: str, request: Request) -> dict[str, Any]:
    await arequire_user_or_device(request)
    return check_username(username)


@router.put("/api/tavus/meetings")
async def save_meeting_route(request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Meeting payload must be an object.")
    return save_meeting_identity(user, payload)
