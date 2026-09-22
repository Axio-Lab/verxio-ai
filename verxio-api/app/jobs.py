"""Durable platform jobs: enqueue + persist a receipt, then consume later."""

from __future__ import annotations

import asyncio
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
    list_pop,
    list_push,
    lookup_tenant_holder,
    worker_stream,
)
from app.models import new_id

logger = logging.getLogger(__name__)


def deliver_list_key(workspace_id: str, agent_id: str) -> str:
    return f"deliver:{workspace_id}:{agent_id}"


def _persist_job(
    *,
    job_id: str,
    stream: str,
    kind: str,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    body: dict[str, Any],
) -> None:
    created = now_iso()
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


def _stream_fields(
    *, job_id: str, kind: str, tenant_id: str, workspace_id: str, agent_id: str, body: dict[str, Any]
) -> dict[str, Any]:
    return {
        "job_id": job_id,
        "kind": kind,
        "tenant_id": tenant_id,
        "workspace_id": workspace_id,
        "agent_id": agent_id,
        "payload": body,
    }


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
    body = payload or {}
    _persist_job(
        job_id=job_id,
        stream=stream,
        kind=kind,
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        body=body,
    )
    enqueue(
        stream,
        _stream_fields(
            job_id=job_id, kind=kind, tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
        ),
    )
    return job_id


def route_turn_stream(workspace_id: str, agent_id: str) -> str:
    """Per-holder stream when a live worker leases the tenant, else the shared stream."""
    holder = lookup_tenant_holder(workspace_id, agent_id)
    if holder and holder.get("worker"):
        return worker_stream(str(holder["worker"]))
    return STREAM_TURNS


def enqueue_turn(
    *,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    source: str,
    payload: dict[str, Any],
) -> str:
    job_id = new_id("job")
    body = {"source": source, **payload}
    _persist_job(
        job_id=job_id,
        stream=STREAM_TURNS,
        kind="turn",
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        body=body,
    )
    enqueue(
        route_turn_stream(workspace_id, agent_id),
        _stream_fields(
            job_id=job_id, kind="turn", tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
        ),
    )
    return job_id


def requeue_turn_to(stream: str, fields: dict[str, Any]) -> None:
    """Move an already-persisted turn to another stream (holder hand-off)."""
    payload = fields.get("payload")
    if isinstance(payload, str):
        try:
            payload = json.loads(payload)
        except json.JSONDecodeError:
            payload = {}
    enqueue(
        stream,
        _stream_fields(
            job_id=str(fields.get("job_id") or ""),
            kind=str(fields.get("kind") or "turn"),
            tenant_id=str(fields.get("tenant_id") or ""),
            workspace_id=str(fields.get("workspace_id") or ""),
            agent_id=str(fields.get("agent_id") or ""),
            body=payload if isinstance(payload, dict) else {},
        ),
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
    """Queue an outbound message for the tenant's channel gateway.

    Deliveries are per-tenant FIFOs (the gateway that owns the tenant's
    connections long-polls its own list), with a receipt in ``platform_jobs``.
    """
    job_id = new_id("job")
    body = {"platform": platform, **payload}
    _persist_job(
        job_id=job_id,
        stream=STREAM_DELIVER,
        kind="deliver",
        tenant_id=tenant_id,
        workspace_id=workspace_id,
        agent_id=agent_id,
        body=body,
    )
    list_push(
        deliver_list_key(workspace_id, agent_id),
        {"job_id": job_id, "workspace_id": workspace_id, "agent_id": agent_id, **body},
    )
    return job_id


def pop_delivery(workspace_id: str, agent_id: str, *, timeout_seconds: float = 25.0) -> dict[str, Any] | None:
    item = list_pop(deliver_list_key(workspace_id, agent_id), timeout_seconds=timeout_seconds)
    if item and item.get("job_id"):
        mark_job(str(item["job_id"]), status="delivering")
    return item


def mark_job(job_id: str, *, status: str, error: str | None = None) -> None:
    db.execute(
        """
        UPDATE platform_jobs
        SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ?
        """,
        (status, error, now_iso(), job_id),
    )


def get_job(job_id: str) -> dict[str, Any] | None:
    return db.fetch_one("SELECT * FROM platform_jobs WHERE id = ?", (job_id,))


# ------------------------------------------------------------------ async API
# Event-loop friendly variants for FastAPI routes and async services. The
# receipt goes through ``db.aexecute`` (off-loop DB worker) and the Redis
# XADD/LPUSH through a thread, so a slow Turso round-trip never stalls other
# requests on the same API replica.
async def _apersist_job(
    *,
    job_id: str,
    stream: str,
    kind: str,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    body: dict[str, Any],
) -> None:
    created = now_iso()
    await db.aexecute(
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


async def aenqueue_job(
    *,
    stream: str,
    kind: str,
    tenant_id: str = "",
    workspace_id: str = "",
    agent_id: str = "",
    payload: dict[str, Any] | None = None,
) -> str:
    job_id = new_id("job")
    body = payload or {}
    await _apersist_job(
        job_id=job_id, stream=stream, kind=kind, tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
    )
    await asyncio.to_thread(
        enqueue,
        stream,
        _stream_fields(job_id=job_id, kind=kind, tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body),
    )
    return job_id


async def aenqueue_turn(
    *,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    source: str,
    payload: dict[str, Any],
) -> str:
    job_id = new_id("job")
    body = {"source": source, **payload}
    await _apersist_job(
        job_id=job_id, stream=STREAM_TURNS, kind="turn", tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
    )

    def _push() -> None:
        enqueue(
            route_turn_stream(workspace_id, agent_id),
            _stream_fields(
                job_id=job_id, kind="turn", tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
            ),
        )

    await asyncio.to_thread(_push)
    return job_id


async def aenqueue_webhook_delivery(*, kind: str, payload: dict[str, Any], tenant_id: str = "", workspace_id: str = "", agent_id: str = "") -> str:
    return await aenqueue_job(
        stream=STREAM_WEBHOOKS, kind=kind, tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, payload=payload
    )


async def aenqueue_deliver(
    *,
    workspace_id: str,
    agent_id: str,
    platform: str,
    payload: dict[str, Any],
    tenant_id: str = "",
) -> str:
    job_id = new_id("job")
    body = {"platform": platform, **payload}
    await _apersist_job(
        job_id=job_id, stream=STREAM_DELIVER, kind="deliver", tenant_id=tenant_id, workspace_id=workspace_id, agent_id=agent_id, body=body
    )
    await asyncio.to_thread(
        list_push,
        deliver_list_key(workspace_id, agent_id),
        {"job_id": job_id, "workspace_id": workspace_id, "agent_id": agent_id, **body},
    )
    return job_id


async def apop_delivery(workspace_id: str, agent_id: str, *, timeout_seconds: float = 25.0) -> dict[str, Any] | None:
    item = await asyncio.to_thread(list_pop, deliver_list_key(workspace_id, agent_id), timeout_seconds=timeout_seconds)
    if item and item.get("job_id"):
        await amark_job(str(item["job_id"]), status="delivering")
    return item


async def amark_job(job_id: str, *, status: str, error: str | None = None) -> None:
    await db.aexecute(
        """
        UPDATE platform_jobs
        SET status = ?, last_error = ?, attempts = attempts + 1, updated_at = ?
        WHERE id = ?
        """,
        (status, error, now_iso(), job_id),
    )
