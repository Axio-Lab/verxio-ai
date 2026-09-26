"""Leader-elected scheduler: workflow ticks, reconcile, cron enqueue.

Run as ``python -m app.scheduler`` in production. The API process no longer
owns these loops when ``VERXIO_INLINE_SCHEDULER`` is off.
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
from contextlib import suppress

from app import db
from app.infra.redis import heartbeat_lease, release_lease, try_acquire_lease, worker_id

logger = logging.getLogger("verxio.scheduler")

LEADER_KEY = "scheduler-leader"


def _env_truthy(name: str, default: str = "1") -> bool:
    return os.getenv(name, default).strip().lower() not in {"0", "false", "no", "off"}


async def _hold_leadership(token: str, stop: asyncio.Event) -> None:
    while not stop.is_set():
        if not heartbeat_lease(LEADER_KEY, token, ttl_seconds=30):
            logger.warning("Lost scheduler leadership")
            stop.set()
            return
        try:
            await asyncio.wait_for(stop.wait(), timeout=10)
        except asyncio.TimeoutError:
            continue


async def _workflow_loop(stop: asyncio.Event) -> None:
    from app.workflow_agents import tick_due_schedule_triggers

    try:
        interval = max(5.0, float(os.getenv("VERXIO_WORKFLOW_SCHEDULER_INTERVAL_SECONDS", "15")))
    except ValueError:
        interval = 15.0
    while not stop.is_set():
        try:
            await tick_due_schedule_triggers()
        except Exception:
            logger.exception("Workflow schedule tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def _reconcile_loop(stop: asyncio.Event) -> None:
    from app.runtime_orch.lifecycle import reconcile_missing_runtimes

    interval = max(30.0, float(os.getenv("VERXIO_RECONCILE_INTERVAL_SECONDS", "120")))
    while not stop.is_set():
        try:
            await reconcile_missing_runtimes(wake=True, reason="scheduler.reconcile")
        except Exception:
            logger.exception("Reconcile tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def _runtime_watchdog_loop(stop: asyncio.Event) -> None:
    """Restart wedged dashboards before users see 'Reconnecting'."""
    from app.runtime_orch.watchdog import heal_unhealthy_runtimes

    interval = max(5.0, float(os.getenv("VERXIO_RUNTIME_WATCHDOG_INTERVAL_SECONDS", "15")))
    while not stop.is_set():
        try:
            result = await heal_unhealthy_runtimes()
            if result["healed"]:
                logger.warning("Runtime watchdog healed: %s", ", ".join(result["healed"]))
        except Exception:
            logger.exception("Runtime watchdog tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def _cron_loop(stop: asyncio.Event) -> None:
    from app.cron_store import enqueue_due_cron_jobs

    interval = max(15.0, float(os.getenv("VERXIO_CRON_TICK_SECONDS", "30")))
    while not stop.is_set():
        try:
            await asyncio.to_thread(enqueue_due_cron_jobs)
        except Exception:
            logger.exception("Tenant cron tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def _outputs_ttl_loop(stop: asyncio.Event) -> None:
    from app.agent_sync import expire_all_outputs

    interval = max(300.0, float(os.getenv("VERXIO_OUTPUTS_TTL_SECONDS", "3600")))
    while not stop.is_set():
        try:
            expired = await asyncio.to_thread(expire_all_outputs)
            if expired:
                logger.info("Expired %d cloud outputs past the 7-day TTL", expired)
        except Exception:
            logger.exception("Outputs TTL tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def _idle_reaper_loop(stop: asyncio.Event) -> None:
    from app.runtime_orch.lifecycle import reap_idle_runtimes
    from app.runtime_orch.idle import idle_enabled

    interval = max(30.0, float(os.getenv("VERXIO_IDLE_REAPER_INTERVAL_SECONDS", "60")))
    limit = int(os.getenv("VERXIO_IDLE_REAPER_LIMIT", "50") or "50")
    while not stop.is_set():
        if idle_enabled():
            try:
                drained = await reap_idle_runtimes(limit=limit)
                if drained:
                    logger.info("Idle reaper drained %d runtime(s)", len(drained))
            except Exception:
                logger.exception("Idle reaper tick failed")
        try:
            await asyncio.wait_for(stop.wait(), timeout=interval)
        except asyncio.TimeoutError:
            continue


async def run_scheduler() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    if _env_truthy("VERXIO_AUTO_MIGRATE", "0"):
        db.run_migrations()

    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        with suppress(NotImplementedError):
            loop.add_signal_handler(sig, stop.set)

    logger.info("Scheduler starting worker=%s", worker_id())
    while not stop.is_set():
        token = try_acquire_lease(LEADER_KEY, ttl_seconds=30, token=worker_id())
        if token is None:
            logger.info("Waiting for scheduler leadership")
            try:
                await asyncio.wait_for(stop.wait(), timeout=8)
            except asyncio.TimeoutError:
                continue
            continue
        logger.info("Acquired scheduler leadership")
        lost = asyncio.Event()
        tasks = [
            asyncio.create_task(_hold_leadership(token, lost), name="leader-heartbeat"),
            asyncio.create_task(_workflow_loop(lost), name="workflow-ticks"),
            asyncio.create_task(_cron_loop(lost), name="cron-ticks"),
            asyncio.create_task(_outputs_ttl_loop(lost), name="outputs-ttl"),
        ]
        if _env_truthy("VERXIO_IDLE_REAPER_ENABLED", "true"):
            tasks.append(asyncio.create_task(_idle_reaper_loop(lost), name="idle-reaper"))
        if _env_truthy("VERXIO_RECONCILE_ENABLED", "1"):
            tasks.append(asyncio.create_task(_reconcile_loop(lost), name="reconcile"))
        if _env_truthy("VERXIO_RUNTIME_WATCHDOG_ENABLED", "1"):
            tasks.append(asyncio.create_task(_runtime_watchdog_loop(lost), name="runtime-watchdog"))
        wait_stop = asyncio.create_task(stop.wait())
        wait_lost = asyncio.create_task(lost.wait())
        done, pending = await asyncio.wait({wait_stop, wait_lost}, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        for task in tasks:
            task.cancel()
            with suppress(asyncio.CancelledError):
                await task
        release_lease(LEADER_KEY, token)
        if stop.is_set():
            break
    logger.info("Scheduler stopped")


def main() -> None:
    asyncio.run(run_scheduler())


if __name__ == "__main__":
    main()
