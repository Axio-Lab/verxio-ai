"""Tavus HTTP routes. Each feature module owns its handlers."""

from __future__ import annotations

from fastapi import APIRouter

from app.tavus_profile import router as profile_router

router = APIRouter()
router.include_router(profile_router)
