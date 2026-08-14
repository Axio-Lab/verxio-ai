"""Background workers: idle reaper + wake queue (production)."""

from __future__ import annotations

import asyncio
import logging
import os
from contextlib import suppress

from app import db
from app.control_plane import runtime_from_row
from app.runtime_orch.idle import idle_enabled
from app.runtime_orch.lifecycle import reap_idle_runtimes, wake_runtime
from app.runtime_orch.wake_queue import WakeJob, get_wake_queue

logger = logging.getLogger(__name__)


async def _handle_wake_job(job: WakeJob) -> None:
    row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (job.runtime_id,))
    if not row:
        logger.warning("Wake job for missing runtime %s", job.runtime_id)
        return
    runtime = runtime_from_row(row)
    await wake_runtime(runtime, wait_ready=True, reason=job.reason or "wake_queue")


async def idle_reaper_loop() -> None:
    try:
        interval = max(30.0, float(os.getenv("VERXIO_IDLE_REAPER_INTERVAL_SECONDS", "60")))
    except ValueError:
        interval = 60.0
    limit = int(os.getenv("VERXIO_IDLE_REAPER_LIMIT", "50") or "50")
    while True:
        await asyncio.sleep(interval)
        if not idle_enabled():
            continue
        try:
            drained = await reap_idle_runtimes(limit=limit)
            if drained:
                logger.info("Idle reaper drained %d runtime(s): %s", len(drained), ",".join(drained))
        except Exception:
            logger.exception("Idle reaper tick failed")


def start_scale_workers() -> list[asyncio.Task[None]]:
    """Start production background tasks. Returns tasks for shutdown cancel."""
    tasks: list[asyncio.Task[None]] = []

    reaper_on = os.getenv("VERXIO_IDLE_REAPER_ENABLED", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }
    if reaper_on:
        tasks.append(asyncio.create_task(idle_reaper_loop(), name="verxio-idle-reaper"))

    queue = get_wake_queue()
    queue.set_handler(_handle_wake_job)
    queue.ensure_worker()
    # Wake queue owns its own task; track a sentinel no-op for API symmetry.
    return tasks


async def stop_scale_workers(tasks: list[asyncio.Task[None]]) -> None:
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
