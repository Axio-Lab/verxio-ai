"""Durable platform jobs: enqueue + persist a receipt, then consume later."""

from __future__ import annotations

import json
import logging
from typing import Any

from app import db
from app.control_plane import now_iso
from app.infra.redis import (
    STREAM_DELIVER,
    STREAM_TURNS,
    STREAM_WEBHOOKS,
    enqueue,
)
from app.models import new_id

logger = logging.getLogger(__name__)


def enqueue_job(
    *,
    stream: str,
    kind: str,
    tenant_id: str = "",
    workspace_id: str = "",
    agent_id: str = "",
    payload: dict[str, Any] | None = None,
) -> str:
    job_id = new_id("job")
    created = now_iso()
    body = payload or {}
    db.execute(
        """
        INSERT INTO platform_jobs (
            id, stream, kind, tenant_id, workspace_id, agent_id,
            payload_json, status, attempts, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)
        """,
        (
            job_id,
            stream,
            kind,
            tenant_id,
            workspace_id,
            agent_id,
            json.dumps(body, separators=(",", ":")),
            created,
            created,
        ),
    )
    enqueue(
        stream,
        {
            "job_id": job_id,
            "kind": kind,
            "tenant_id": tenant_id,
            "workspace_id": workspace_id,
            "agent_id": agent_id,
            "payload": body,
        },
    )
    return job_id


def enqueue_turn(
    *,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    source: str,
    payload: dict[str, Any],
) -> str:
    return enqueue_job(
        stream=STREAM_TURNS,
        kind="turn",
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        payload={"source": source, **payload},
    )


def enqueue_webhook_delivery(
    *,
    workspace_id: str,
    tenant_id: str = "",
    agent_id: str = "",
    kind: str,
    payload: dict[str, Any],
) -> str:
    return enqueue_job(
        stream=STREAM_WEBHOOKS,
        kind=kind,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        payload=payload,
    )


def enqueue_deliver(
    *,
    workspace_id: str,
    agent_id: str,
    platform: str,
    payload: dict[str, Any],
    tenant_id: str = "",
) -> str:
    return enqueue_job(
        stream=STREAM_DELIVER,
        kind="deliver",
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        payload={"platform": platform, **payload},
    )


def mark_job(job_id: str, *, status: str, error: str | None = None) -> None:
    db.execute(
        """
        UPDATE platform_jobs
        SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ?
        """,
        (status, error, now_iso(), job_id),
    )
