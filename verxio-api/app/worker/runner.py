"""Consume turn/attach jobs, hold tenant leases, bridge events."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from contextlib import suppress
from pathlib import Path
from typing import Any

from app import db
from app.control_plane import runtime_from_row
from app.homes import restore_home, sync_home
from app.infra.redis import (
    GROUP_WORKERS,
    STREAM_ATTACH,
    STREAM_TURNS,
    STREAM_WEBHOOKS,
    heartbeat_lease,
    publish,
    read_group,
    release_lease,
    try_acquire_lease,
    worker_id,
    xack,
)
from app.jobs import mark_job

logger = logging.getLogger("verxio.worker")


def _tenant_lease_key(workspace_id: str, agent_id: str) -> str:
    return f"tenant:{workspace_id}:{agent_id}"


async def _attach(fields: dict[str, str]) -> None:
    workspace_id = fields.get("workspace_id", "")
    agent_id = fields.get("agent_id", "")
    home = fields.get("hermes_home_path", "")
    if not workspace_id or not agent_id:
        return
    token = try_acquire_lease(_tenant_lease_key(workspace_id, agent_id), ttl_seconds=300, token=worker_id())
    if token is None:
        return
    row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (workspace_id, agent_id),
    )
    if row:
        restore_home(runtime_from_row(row), only_if_missing=True)
    if home and os.getenv("VERXIO_INTERNAL_TOKEN"):
        await _notify_hermes_attach(workspace_id, agent_id, home)


async def _notify_hermes_attach(workspace_id: str, agent_id: str, home: str) -> None:
    import httpx

    tenant = f"{workspace_id}:{agent_id}"
    base = os.getenv("VERXIO_LOCAL_HERMES_URL", "http://127.0.0.1:9119").rstrip("/")
    token = os.getenv("VERXIO_INTERNAL_TOKEN", "")
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(
                f"{base}/internal/profiles/{tenant}/attach",
                json={"home": home},
                headers={"X-Verxio-Internal-Token": token},
            )
    except Exception:
        logger.warning("Hermes attach failed tenant=%s", tenant, exc_info=True)


async def _handle_turn(fields: dict[str, str]) -> None:
    workspace_id = fields.get("workspace_id", "")
    agent_id = fields.get("agent_id", "")
    job_id = fields.get("job_id", "")
    payload_raw = fields.get("payload") or "{}"
    try:
        payload = json.loads(payload_raw) if isinstance(payload_raw, str) else {}
    except json.JSONDecodeError:
        payload = {}
    lease_key = _tenant_lease_key(workspace_id, agent_id)
    token = try_acquire_lease(lease_key, ttl_seconds=300, token=worker_id()) or worker_id()
    heartbeat_lease(lease_key, token, ttl_seconds=300)
    publish(
        f"verxio:turns:{workspace_id}:{agent_id}",
        {"status": "started", "source": payload.get("source"), "job_id": job_id},
    )
    if job_id:
        mark_job(job_id, status="running")
    # The colocated Hermes process runs the turn via dashboard/gateway.
    publish(
        f"verxio:turns:{workspace_id}:{agent_id}",
        {"status": "queued_to_hermes", "job_id": job_id, "payload": payload},
    )
    if job_id:
        mark_job(job_id, status="completed")


async def _consume(stream: str, handler) -> None:
    consumer = worker_id()
    while True:
        messages = await asyncio.to_thread(read_group, stream, GROUP_WORKERS, consumer, count=4, block_ms=2000)
        for message_id, fields in messages:
            try:
                await handler(fields)
                await asyncio.to_thread(xack, stream, GROUP_WORKERS, message_id)
            except Exception:
                logger.exception("Worker failed stream=%s id=%s", stream, message_id)


async def run_worker() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if os.getenv("VERXIO_AUTO_MIGRATE", "0").strip() in {"1", "true"}:
        db.run_migrations()
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)
    logger.info("Agent worker starting id=%s", worker_id())
    tasks = [
        asyncio.create_task(_consume(STREAM_TURNS, _handle_turn), name="turns"),
        asyncio.create_task(_consume(STREAM_ATTACH, _attach), name="attach"),
        asyncio.create_task(_consume(STREAM_WEBHOOKS, _handle_turn), name="webhooks"),
    ]
    await stop.wait()
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
