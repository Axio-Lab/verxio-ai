"""Async wake queue for channel/cron cold starts (Phase 5)."""

from __future__ import annotations

import asyncio
import os
import time
from collections import deque
from dataclasses import dataclass, field
from typing import Awaitable, Callable


@dataclass
class WakeJob:
    runtime_id: str
    tenant_id: str
    reason: str
    enqueued_at: float = field(default_factory=time.time)
    attempts: int = 0


WakeHandler = Callable[[WakeJob], Awaitable[None]]


class WakeQueue:
    """In-process FIFO wake queue. Swap for Redis/SQS in multi-node deploy."""

    def __init__(self, *, maxsize: int = 10_000) -> None:
        self._q: deque[WakeJob] = deque()
        self._maxsize = maxsize
        self._lock = asyncio.Lock()
        self._handler: WakeHandler | None = None
        self._worker_task: asyncio.Task[None] | None = None

    def set_handler(self, handler: WakeHandler) -> None:
        self._handler = handler

    async def enqueue(self, job: WakeJob) -> bool:
        async with self._lock:
            if len(self._q) >= self._maxsize:
                return False
            # Deduplicate pending wakes for the same runtime.
            if any(item.runtime_id == job.runtime_id for item in self._q):
                return True
            self._q.append(job)
            return True

    async def depth(self) -> int:
        async with self._lock:
            return len(self._q)

    async def _worker(self) -> None:
        while True:
            job: WakeJob | None = None
            async with self._lock:
                if self._q:
                    job = self._q.popleft()
            if job is None:
                await asyncio.sleep(0.25)
                continue
            handler = self._handler
            if handler is None:
                continue
            try:
                await handler(job)
            except Exception:
                job.attempts += 1
                if job.attempts < 3:
                    async with self._lock:
                        self._q.append(job)
                # else drop after retries; metrics hook later

    def ensure_worker(self) -> None:
        if self._worker_task is None or self._worker_task.done():
            self._worker_task = asyncio.create_task(self._worker(), name="verxio-wake-queue")


_QUEUE: WakeQueue | None = None


def get_wake_queue() -> WakeQueue:
    global _QUEUE
    if _QUEUE is None:
        maxsize = int(os.getenv("VERXIO_WAKE_QUEUE_MAX", "10000") or "10000")
        _QUEUE = WakeQueue(maxsize=maxsize)
    return _QUEUE


def reset_wake_queue_for_tests() -> None:
    global _QUEUE
    _QUEUE = None
