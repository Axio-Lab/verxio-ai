"""Tenant cron definitions synced from Hermes and fired by verxio-scheduler.

Hermes keeps each tenant's jobs in ``{hermes-home}/cron/jobs.json``. On the
pool plane the in-process ticker is disabled (``plugins/cron/verxio``); the
Hermes side publishes job definitions here, ``verxio-scheduler`` fires due
jobs as ``cron`` turns on the worker pool, and the worker posts the result
back both to ``tenant_cron_jobs`` and into the tenant's ``jobs.json`` so the
Hermes cron UI / ``hermes cron status`` reflect the run.

Schedules keep Hermes' structured form::

    {"kind": "cron", "expr": "0 9 * * *"}
    {"kind": "interval", "minutes": 30}
    {"kind": "once", "run_at": "2026-02-03T14:00:00+00:00"}

Plain cron expressions / ``every 30m`` strings are accepted as well.
"""

from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from croniter import croniter

from app import db
from app.control_plane import now_iso
from app.jobs import enqueue_turn
from app.models import new_id

logger = logging.getLogger(__name__)

_DURATION_RE = re.compile(r"^(\d+)\s*([mhd])$", re.IGNORECASE)
_MAX_OUTPUT = 20_000


# ------------------------------------------------------------------ schedule
def parse_schedule(raw: Any) -> dict[str, Any]:
    """Normalise a Hermes schedule (dict or string) to ``{"kind": ...}``."""
    if isinstance(raw, dict):
        kind = str(raw.get("kind") or "").lower()
        if kind == "cron" and raw.get("expr"):
            return {"kind": "cron", "expr": str(raw["expr"])}
        if kind == "interval" and raw.get("minutes"):
            return {"kind": "interval", "minutes": max(1, int(raw["minutes"]))}
        if kind == "once" and raw.get("run_at"):
            return {"kind": "once", "run_at": str(raw["run_at"])}
        raise ValueError(f"unsupported schedule {raw!r}")
    text = str(raw or "").strip()
    if not text:
        raise ValueError("empty schedule")
    if text.startswith("{"):
        return parse_schedule(json.loads(text))
    lowered = text.lower()
    if lowered.startswith("every "):
        match = _DURATION_RE.match(text[6:].strip())
        if not match:
            raise ValueError(f"bad interval {text!r}")
        value, unit = int(match.group(1)), match.group(2).lower()
        return {"kind": "interval", "minutes": value * {"m": 1, "h": 60, "d": 1440}[unit]}
    if croniter.is_valid(text):
        return {"kind": "cron", "expr": text}
    if "T" in text or re.match(r"^\d{4}-\d{2}-\d{2}", text):
        return {"kind": "once", "run_at": datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()}
    match = _DURATION_RE.match(text)
    if match:
        value, unit = int(match.group(1)), match.group(2).lower()
        run_at = datetime.now(timezone.utc) + timedelta(minutes=value * {"m": 1, "h": 60, "d": 1440}[unit])
        return {"kind": "once", "run_at": run_at.isoformat()}
    raise ValueError(f"unrecognised schedule {text!r}")


def schedule_to_text(schedule: dict[str, Any]) -> str:
    return json.dumps(schedule, separators=(",", ":"), sort_keys=True)


def _aware(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def next_run_at(schedule: dict[str, Any], *, after: datetime | None = None) -> str | None:
    """Next fire time in UTC ISO, or ``None`` for a one-shot that already ran."""
    after = after or datetime.now(timezone.utc)
    kind = schedule.get("kind")
    if kind == "cron":
        return croniter(str(schedule["expr"]), after).get_next(datetime).astimezone(timezone.utc).isoformat()
    if kind == "interval":
        return (after + timedelta(minutes=int(schedule["minutes"]))).astimezone(timezone.utc).isoformat()
    if kind == "once":
        run_at = _aware(str(schedule["run_at"]))
        return run_at.astimezone(timezone.utc).isoformat() if run_at > after else None
    raise ValueError(f"unsupported schedule {schedule!r}")


# ------------------------------------------------------------------ delivery
def delivery_target(job: dict[str, Any]) -> dict[str, str] | None:
    """Resolve a Hermes ``deliver`` value to ``{"platform", "chat_id"}``.

    ``origin`` (default when the job was created from a channel) uses the
    job's ``origin`` block; ``telegram:12345`` style values are explicit;
    ``local`` / empty means no delivery (output stays in the run log).
    """
    deliver = job.get("deliver")
    if isinstance(deliver, (list, tuple)):
        deliver = ",".join(str(p) for p in deliver if str(p).strip())
    deliver = str(deliver or "local").strip()
    origin = job.get("origin") if isinstance(job.get("origin"), dict) else {}
    for part in [p.strip() for p in deliver.split(",") if p.strip()]:
        lowered = part.lower()
        if lowered == "local":
            continue
        if lowered == "origin":
            platform = str(origin.get("platform") or "").strip()
            chat_id = str(origin.get("chat_id") or "").strip()
            if platform and chat_id and platform.lower() != "local":
                return {"platform": platform, "chat_id": chat_id}
            continue
        if ":" in part:
            platform, chat_id = part.split(":", 1)
            if platform.strip() and chat_id.strip():
                return {"platform": platform.strip(), "chat_id": chat_id.strip()}
            continue
        # Bare platform name → that platform's origin chat if it matches.
        if origin.get("platform") and str(origin["platform"]).lower() == lowered and origin.get("chat_id"):
            return {"platform": part, "chat_id": str(origin["chat_id"])}
    return None


# ---------------------------------------------------------------------- sync
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
        if not isinstance(job, dict):
            continue
        name = str(job.get("name") or job.get("id") or "").strip()
        if not name:
            continue
        try:
            schedule = parse_schedule(job.get("schedule"))
        except (ValueError, TypeError, json.JSONDecodeError) as exc:
            logger.warning("Skipping cron job %s for %s:%s: %s", name, workspace_id, agent_id, exc)
            continue
        names.append(name)
        schedule_text = schedule_to_text(schedule)
        enabled = 0 if (job.get("enabled") is False or job.get("state") == "paused") else 1
        prompt = str(job.get("prompt") or job.get("command") or job.get("script") or "")
        payload = json.dumps(job, separators=(",", ":"), default=str)
        existing = db.fetch_one(
            """
            SELECT id, schedule, next_run_at FROM tenant_cron_jobs
            WHERE workspace_id = ? AND agent_id = ? AND name = ?
            """,
            (workspace_id, agent_id, name),
        )
        hermes_next = str(job.get("next_run_at") or "").strip() or None
        if existing:
            # Recompute next_run_at only when the schedule changed; otherwise
            # keep the scheduler's own cursor so re-syncs don't double fire.
            if existing.get("schedule") != schedule_text or not existing.get("next_run_at"):
                nxt = hermes_next or next_run_at(schedule)
            else:
                nxt = existing["next_run_at"]
            db.execute(
                """
                UPDATE tenant_cron_jobs
                SET schedule = ?, prompt = ?, enabled = ?, next_run_at = ?, metadata_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (schedule_text, prompt, enabled, nxt, payload, now, existing["id"]),
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
                    schedule_text,
                    prompt,
                    enabled,
                    hermes_next or next_run_at(schedule),
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
    else:
        db.execute(
            "DELETE FROM tenant_cron_jobs WHERE workspace_id = ? AND agent_id = ?",
            (workspace_id, agent_id),
        )
    return len(names)


# ---------------------------------------------------------------------- fire
def enqueue_due_cron_jobs(*, limit: int = 50) -> list[str]:
    now = datetime.now(timezone.utc)
    rows = db.fetch_all(
        """
        SELECT * FROM tenant_cron_jobs
        WHERE enabled = 1 AND next_run_at IS NOT NULL AND next_run_at <= ?
        ORDER BY next_run_at ASC
        LIMIT ?
        """,
        (now.isoformat(), limit),
    )
    fired: list[str] = []
    for row in rows:
        try:
            meta = json.loads(str(row.get("metadata_json") or "{}"))
        except json.JSONDecodeError:
            meta = {}
        try:
            schedule = parse_schedule(row["schedule"])
        except (ValueError, TypeError, json.JSONDecodeError):
            logger.warning("Disabling cron job %s with unparsable schedule", row.get("id"))
            db.execute("UPDATE tenant_cron_jobs SET enabled = 0, updated_at = ? WHERE id = ?", (now_iso(), row["id"]))
            continue
        try:
            payload: dict[str, Any] = {
                "cron_job_id": row["id"],
                "hermes_job_id": str(meta.get("id") or ""),
                "name": row["name"],
                "prompt": row.get("prompt") or "",
                "instructions": str(meta.get("instructions") or "") or None,
                "model": str(meta.get("model") or "") or None,
            }
            deliver = delivery_target(meta)
            if deliver:
                payload["deliver"] = deliver
            enqueue_turn(
                tenant_id=str(row["tenant_id"]),
                workspace_id=str(row["workspace_id"]),
                agent_id=str(row["agent_id"]),
                source="cron",
                payload=payload,
            )
            nxt = next_run_at(schedule, after=now)
            db.execute(
                """
                UPDATE tenant_cron_jobs
                SET last_run_at = ?, next_run_at = ?, enabled = ?, last_status = 'running', updated_at = ?
                WHERE id = ?
                """,
                (now.isoformat(), nxt, 1 if nxt else 0, now_iso(), row["id"]),
            )
            fired.append(str(row["id"]))
        except Exception:
            logger.exception("Failed to enqueue cron job %s", row.get("id"))
    return fired


# ------------------------------------------------------------------ results
def record_cron_result(
    cron_job_id: str,
    *,
    status: str,
    output: str = "",
    error: str | None = None,
    home: Path | str | None = None,
) -> None:
    """Worker post-back after a cron-triggered turn.

    Updates ``tenant_cron_jobs`` and, when ``home`` (the tenant's Hermes home
    on the worker) is given, the matching entry in ``cron/jobs.json`` so the
    Hermes cron UI shows ``last_run_at`` / ``last_status`` / ``last_error``.
    """
    row = db.fetch_one("SELECT * FROM tenant_cron_jobs WHERE id = ?", (cron_job_id,))
    db.execute(
        """
        UPDATE tenant_cron_jobs
        SET last_status = ?, last_output = ?, last_error = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, output[:_MAX_OUTPUT], error, now_iso(), cron_job_id),
    )
    if home is None or not row:
        return
    try:
        meta = json.loads(str(row.get("metadata_json") or "{}"))
    except json.JSONDecodeError:
        meta = {}
    write_back_home(
        Path(home),
        hermes_job_id=str(meta.get("id") or ""),
        name=str(row.get("name") or ""),
        status=status,
        error=error,
        next_run_at=row.get("next_run_at"),
        enabled=bool(row.get("enabled", 1)),
    )


def write_back_home(
    home: Path,
    *,
    hermes_job_id: str,
    name: str,
    status: str,
    error: str | None,
    next_run_at: str | None,
    enabled: bool,
) -> bool:
    """Mirror a run result into ``{home}/cron/jobs.json`` (atomic rewrite)."""
    jobs_file = home / "cron" / "jobs.json"
    if not jobs_file.is_file():
        return False
    try:
        data = json.loads(jobs_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        logger.warning("Could not read %s for cron post-back", jobs_file)
        return False
    jobs = data.get("jobs") if isinstance(data, dict) else data
    if not isinstance(jobs, list):
        return False
    now = now_iso()
    changed = False
    for job in jobs:
        if not isinstance(job, dict):
            continue
        if (hermes_job_id and str(job.get("id")) == hermes_job_id) or (not hermes_job_id and job.get("name") == name):
            job["last_run_at"] = now
            job["last_status"] = "ok" if status == "completed" else status
            job["last_error"] = error
            job["next_run_at"] = next_run_at
            if not enabled and job.get("schedule", {}).get("kind") == "once":
                job["state"] = "completed"
                job["enabled"] = False
            stats = job.get("stats") if isinstance(job.get("stats"), dict) else {}
            if status == "completed":
                stats["completed"] = int(stats.get("completed") or 0) + 1
            else:
                stats["failed"] = int(stats.get("failed") or 0) + 1
            job["stats"] = stats
            changed = True
            break
    if not changed:
        return False
    payload = {"jobs": jobs} if isinstance(data, dict) else jobs
    fd, tmp = tempfile.mkstemp(prefix=".jobs-", suffix=".json", dir=str(jobs_file.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(payload, handle, indent=2)
        os.replace(tmp, jobs_file)
    except OSError:
        logger.warning("Could not write %s for cron post-back", jobs_file, exc_info=True)
        try:
            os.unlink(tmp)
        except OSError:
            pass
        return False
    return True


def list_cron_jobs(workspace_id: str, agent_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        """
        SELECT * FROM tenant_cron_jobs
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY name ASC
        """,
        (workspace_id, agent_id),
    )
    out: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["metadata"] = json.loads(str(item.pop("metadata_json", "") or "{}"))
        except json.JSONDecodeError:
            item["metadata"] = {}
        try:
            item["schedule"] = parse_schedule(item.get("schedule"))
        except (ValueError, TypeError, json.JSONDecodeError):
            pass
        out.append(item)
    return out
