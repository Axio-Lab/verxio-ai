"""Minute budget and deletion of a user's Tavus resources."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.tavus_client import request as tavus_request
from app.tavus_profile import profile_row

router = APIRouter()


def period_key(now: datetime | None = None) -> str:
    current = now or datetime.now(timezone.utc)
    return current.strftime("%Y-%m")


def remaining_seconds(profile: dict[str, Any]) -> int:
    budget = int(profile.get("monthly_minute_budget") or 60)
    used = int(profile.get("minutes_used") or 0)
    if str(profile.get("minutes_period") or "") != period_key():
        used = 0
    remaining = max(budget - used, 0)
    if remaining <= 0:
        raise HTTPException(status_code=429, detail="Monthly call minutes are used up.")
    return remaining * 60


def add_minutes(user_id: str, minutes: int) -> None:
    row = profile_row(user_id)
    if not row:
        return
    period = period_key()
    used = int(row.get("minutes_used") or 0)
    if str(row.get("minutes_period") or "") != period:
        used = 0
    db.execute(
        "UPDATE tavus_profiles SET minutes_used = ?, minutes_period = ?, updated_at = ? WHERE user_id = ?",
        (used + max(minutes, 0), period, now_iso(), user_id),
    )


def cleanup_user(user_id: str) -> None:
    profile = profile_row(user_id) or {}
    for key in ("pal_id", "share_pal_id"):
        pal_id = str(profile.get(key) or "")
        if pal_id:
            _delete(f"/v2/pals/{pal_id}")
    deployment_id = str(profile.get("deployment_id") or "")
    if deployment_id:
        _delete(f"/v2/deployments/{deployment_id}")
    dictionary_id = str(profile.get("pronunciation_dictionary_id") or "")
    if dictionary_id:
        _delete(f"/v2/pronunciation-dictionaries/{dictionary_id}")
    assets = db.fetch_all("SELECT kind, tavus_id FROM tavus_assets WHERE user_id = ?", (user_id,))
    for asset in assets:
        kind = str(asset.get("kind") or "")
        tavus_id = str(asset.get("tavus_id") or "")
        if kind == "face":
            _delete(f"/v2/faces/{tavus_id}")
        elif kind == "voice":
            _delete(f"/v2/voices/{tavus_id}")
        elif kind == "document":
            _delete(f"/v2/documents/{tavus_id}")
        elif kind == "memory":
            _delete(f"/v2/memory-stores/{tavus_id}")
    db.execute("DELETE FROM tavus_pinned_facts WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM tavus_assets WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM tavus_files WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM tavus_tasks WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM tavus_conversations WHERE user_id = ?", (user_id,))
    db.execute("DELETE FROM tavus_profiles WHERE user_id = ?", (user_id,))


def _delete(path: str) -> None:
    try:
        tavus_request("DELETE", path)
    except Exception:
        return


@router.delete("/api/tavus/profile")
async def delete_profile_route(request: Request) -> dict[str, bool]:
    user = await arequire_user_or_device(request)
    cleanup_user(str(user["id"]))
    return {"ok": True}
