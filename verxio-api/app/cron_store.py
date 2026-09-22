"""Tenant cron definitions synced from Hermes and fired by verxio-scheduler."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from croniter import croniter

from app import db
from app.control_plane import now_iso
from app.jobs import enqueue_turn
from app.models import new_id

logger = logging.getLogger(__name__)


def upsert_cron_jobs(
    *,
    tenant_id: str,
    workspace_id: str,
    agent_id: str,
    jobs: list[dict[str, Any]],
) -> int:
    now = now_iso()
    names: list[str] = []
    for job in jobs:
        name = str(job.get("name") or job.get("id") or "").strip()
        schedule = str(job.get("schedule") or "").strip()
        if not name or not schedule:
            continue
        names.append(name)
        next_run = _next_run_at(schedule)
        existing = db.fetch_one(
            """
            SELECT id FROM tenant_cron_jobs
            WHERE workspace_id = ? AND agent_id = ? AND name = ?
            """,
            (workspace_id, agent_id, name),
        )
        payload = json.dumps(job, separators=(",", ":"))
        enabled = 0 if job.get("enabled") is False else 1
        prompt = str(job.get("prompt") or job.get("command") or "")
        if existing:
            db.execute(
                """
                UPDATE tenant_cron_jobs
                SET schedule = ?, prompt = ?, enabled = ?, next_run_at = COALESCE(next_run_at, ?),
                    metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (schedule, prompt, enabled, next_run, payload, now, existing["id"]),
            )
        else:
            db.execute(
                """
                INSERT INTO tenant_cron_jobs (
                    id, tenant_id, workspace_id, agent_id, name, schedule, prompt,
                    enabled, next_run_at, last_run_at, source, metadata_json, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 'hermes', ?, ?, ?)
                """,
                (
                    new_id("cron"),
                    tenant_id,
                    workspace_id,
                    agent_id,
                    name,
                    schedule,
                    prompt,
                    enabled,
                    next_run,
                    payload,
                    now,
                    now,
                ),
            )
    if names:
        placeholders = ",".join("?" for _ in names)
        db.execute(
            f"""
            DELETE FROM tenant_cron_jobs
            WHERE workspace_id = ? AND agent_id = ? AND name NOT IN ({placeholders})
            """,
            (workspace_id, agent_id, *names),
        )
    return len(names)


def enqueue_due_cron_jobs(*, limit: int = 50) -> list[str]:
    now = datetime.now(timezone.utc)
    rows = db.fetch_all(
        """
        SELECT * FROM tenant_cron_jobs
        WHERE enabled = 1 AND (next_run_at IS NULL OR next_run_at <= ?)
        ORDER BY next_run_at ASC
        LIMIT ?
        """,
        (now.isoformat(), limit),
    )
    fired: list[str] = []
    for row in rows:
        try:
            enqueue_turn(
                tenant_id=str(row["tenant_id"]),
                workspace_id=str(row["workspace_id"]),
                agent_id=str(row["agent_id"]),
                source="cron",
                payload={"cron_job_id": row["id"], "name": row["name"], "prompt": row.get("prompt") or ""},
            )
            nxt = _next_run_at(str(row["schedule"]), after=now)
            db.execute(
                """
                UPDATE tenant_cron_jobs
                SET last_run_at = ?, next_run_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (now.isoformat(), nxt, now_iso(), row["id"]),
            )
            fired.append(str(row["id"]))
        except Exception:
            logger.exception("Failed to enqueue cron job %s", row.get("id"))
    return fired


def _next_run_at(schedule: str, after: datetime | None = None) -> str:
    after = after or datetime.now(timezone.utc)
    try:
        if croniter.is_valid(schedule):
            return croniter(schedule, after).get_next(datetime).astimezone(timezone.utc).isoformat()
    except Exception:
        pass
    return (after + timedelta(hours=1)).isoformat()
