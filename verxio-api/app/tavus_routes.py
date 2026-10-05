"""Tavus HTTP routes. Each feature module owns its handlers."""

from __future__ import annotations

from fastapi import APIRouter

from app.tavus_calls import router as calls_router
from app.tavus_knowledge import router as knowledge_router
from app.tavus_media import router as media_router
from app.tavus_meetings import router as meetings_router
from app.tavus_profile import router as profile_router
from app.tavus_share import router as share_router
from app.tavus_tasks import router as tasks_router
from app.tavus_webhooks import router as webhooks_router

router = APIRouter()
router.include_router(profile_router)
router.include_router(calls_router)
router.include_router(tasks_router)
router.include_router(knowledge_router)
router.include_router(media_router)
router.include_router(webhooks_router)
router.include_router(meetings_router)
router.include_router(share_router)
