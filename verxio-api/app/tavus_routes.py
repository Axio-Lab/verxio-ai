"""Tavus HTTP routes. Each feature module owns its handlers."""

from __future__ import annotations

from fastapi import APIRouter

from app.tavus_calls import router as calls_router
from app.tavus_profile import router as profile_router
from app.tavus_tasks import router as tasks_router

router = APIRouter()
router.include_router(profile_router)
router.include_router(calls_router)
router.include_router(tasks_router)
