"""Isaac-style human task engine for the Micro-Manager workflow agent."""

from __future__ import annotations

import hashlib
import json
import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import HTTPException

from app import db
from app.control_plane import now_iso
from app.models import (
    AgentProfile,
    MicromgrFlagRecord,
    MicromgrFlagsResponse,
    MicromgrLiveboardResponse,
    MicromgrReportRecord,
    MicromgrReportsResponse,
    MicromgrSubmissionRecord,
    MicromgrTaskCreateRequest,
    MicromgrTaskRecord,
    MicromgrTaskUpdateRequest,
    MicromgrTasksResponse,
    MicromgrWorkerCreateRequest,
    MicromgrWorkerRecord,
    MicromgrWorkerUpdateRequest,
    MicromgrWorkersResponse,
    WorkflowAgentRecord,
    Workspace,
    new_id,
)
from app.runtime_dashboard import run_agent_via_dashboard, send_message_via_dashboard

logger = logging.getLogger(__name__)

MICROMGR_TAG = "micromgr"
PLATFORMS = {"telegram", "whatsapp", "slack", "discord", "email"}
WORKER_ROLES = {"worker", "supervisor", "admin"}
TASK_STATUSES = {"ACTIVE", "PAUSED", "ARCHIVED"}
OPEN_SUBMISSION_STATUSES = ("pending", "collecting", "rejected")
_OUTBOUND_DEDUP_WINDOW = timedelta(minutes=15)
VETTING_INSTRUCTIONS = """You are Isaac, an autonomous operations manager.

OUTPUT MODE: Evidence evaluation (JSON only).

You are reviewing photographic or textual evidence submitted by a worker.
If one or more images are attached to this request, look at them first. Describe what you see, then score against the rules.
Never claim photographic evidence is missing when an image is attached.
Onboarding text such as "Ready" is not evidence.
Respond with ONLY valid JSON in this exact format:
{
  "score": 0-100,
  "passed": true/false,
  "findings": ["finding1", "finding2"],
  "summary": "2-3 sentence analysis in second person"
}

Do not include any text before or after the JSON.
""".strip()

REPORT_INSTRUCTIONS = """You are Isaac, an autonomous operations manager.

OUTPUT MODE: Daily compliance report (markdown).

Structure (use exactly these sections):

## Worker Review
For each worker, write 1-2 sentences summarizing their performance.

## Issues
Problems worth noting, if any. Omit this section entirely if none.
ALWAYS write one issue per line, each starting with "- ".

## Required Actions
Specific next steps, if any. Omit this section entirely if none.
ALWAYS write one step per line, numbered.

Keep the entire report under 200 words.
Output ONLY the markdown report. Start directly with ## Worker Review.
""".strip()


def _json_dumps(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _json_loads(value: Any, default: Any) -> Any:
    if isinstance(value, (dict, list)):
        return value
    if not value:
        return default
    try:
        parsed = json.loads(str(value))
    except (TypeError, ValueError, json.JSONDecodeError):
        return default
    return parsed if parsed is not None else default


def _string_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def _tz(name: str) -> ZoneInfo:
    try:
        return ZoneInfo((name or "UTC").strip() or "UTC")
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def _parse_dt(value: str | None) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _hhmm(value: str | None) -> tuple[int, int] | None:
    raw = str(value or "").strip()
    if not re.fullmatch(r"\d{1,2}:\d{2}", raw):
        return None
    hour, minute = (int(part) for part in raw.split(":"))
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def _format_hhmm(hour: int, minute: int) -> str:
    return f"{hour:02d}:{minute:02d}"


def _zoned_parts(now: datetime, tz_name: str) -> datetime:
    return now.astimezone(_tz(tz_name))


def _wall_to_utc(year: int, month: int, day: int, hour: int, minute: int, tz_name: str) -> datetime:
    return datetime(year, month, day, hour, minute, tzinfo=_tz(tz_name)).astimezone(timezone.utc)


def _within_shift(now: datetime, tz_name: str, start: str | None, end: str | None) -> bool:
    start_parts = _hhmm(start)
    end_parts = _hhmm(end)
    if not start_parts or not end_parts:
        return True
    local = _zoned_parts(now, tz_name)
    current = local.hour * 60 + local.minute
    start_min = start_parts[0] * 60 + start_parts[1]
    end_min = end_parts[0] * 60 + end_parts[1]
    if start_min <= end_min:
        return start_min <= current <= end_min
    return current >= start_min or current <= end_min


def is_micromgr_agent(agent: WorkflowAgentRecord | None) -> bool:
    return bool(agent and MICROMGR_TAG in (agent.tags or []))


def require_micromgr_agent(workspace: Workspace, profile: AgentProfile, agent_id: str) -> WorkflowAgentRecord:
    from app.workflow_agents import get_agent

    agent = get_agent(workspace, profile, agent_id)
    if not is_micromgr_agent(agent):
        raise HTTPException(status_code=400, detail="This agent is not a Micro-Manager.")
    return agent


def _task_from_row(row: dict[str, Any]) -> MicromgrTaskRecord:
    return MicromgrTaskRecord(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        workflow_agent_id=str(row["workflow_agent_id"]),
        name=str(row["name"]),
        description=str(row.get("description") or ""),
        evidence_type=str(row.get("evidence_type") or "PHOTO"),
        recurrence_type=str(row.get("recurrence_type") or "DAILY"),
        recurrence_interval=row.get("recurrence_interval"),
        scheduled_times=_string_list(_json_loads(row.get("scheduled_times_json"), [])),
        timezone=str(row.get("timezone") or "UTC"),
        acceptance_rules=_string_list(_json_loads(row.get("acceptance_rules_json"), [])),
        sample_evidence_url=str(row.get("sample_evidence_url") or ""),
        required_items=_json_loads(row.get("required_items_json"), []),
        scoring_enabled=bool(row.get("scoring_enabled")),
        passing_score=int(row.get("passing_score") or 70),
        grace_minutes=int(row.get("grace_minutes") or 15),
        resubmission_allowed=bool(row.get("resubmission_allowed")),
        report_time=str(row.get("report_time") or "18:00"),
        report_frequency=str(row.get("report_frequency") or "DAILY"),
        report_day_of_week=row.get("report_day_of_week"),
        report_day_of_month=row.get("report_day_of_month"),
        shift_enabled=bool(row.get("shift_enabled")),
        escalation_timeout_min=int(row.get("escalation_timeout_min") or 60),
        delivery_config=_json_loads(row.get("delivery_config_json"), {}) or {},
        status=str(row.get("status") or "ACTIVE"),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _worker_from_row(row: dict[str, Any]) -> MicromgrWorkerRecord:
    return MicromgrWorkerRecord(
        id=str(row["id"]),
        workspace_id=str(row["workspace_id"]),
        workflow_agent_id=str(row["workflow_agent_id"]),
        task_id=str(row["task_id"]),
        name=str(row["name"]),
        platform=str(row["platform"]),
        external_id=str(row["external_id"]),
        connection_id=str(row.get("connection_id") or ""),
        role=str(row.get("role") or "worker"),
        shift_start=row.get("shift_start"),
        shift_end=row.get("shift_end"),
        status=str(row.get("status") or "onboarding"),
        active_flag_count=int(row.get("active_flag_count") or 0),
        total_flag_count=int(row.get("total_flag_count") or 0),
        last_flagged_at=row.get("last_flagged_at"),
        last_flag_reason=row.get("last_flag_reason"),
        risk_level=str(row.get("risk_level") or "healthy"),
        onboarded_at=row.get("onboarded_at"),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _submission_from_row(row: dict[str, Any], items: list[dict[str, Any]] | None = None) -> MicromgrSubmissionRecord:
    return MicromgrSubmissionRecord(
        id=str(row["id"]),
        task_id=str(row["task_id"]),
        worker_id=str(row["worker_id"]),
        due_at=str(row["due_at"]),
        submitted_at=row.get("submitted_at"),
        image_url=str(row.get("image_url") or ""),
        raw_message=str(row.get("raw_message") or ""),
        ai_score=row.get("ai_score"),
        ai_findings=_string_list(_json_loads(row.get("ai_findings_json"), [])),
        ai_feedback=str(row.get("ai_feedback") or ""),
        status=str(row.get("status") or "pending"),
        vet_attempts=int(row.get("vet_attempts") or 0),
        items=items or _submission_items(str(row["id"])),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _flag_from_row(row: dict[str, Any]) -> MicromgrFlagRecord:
    return MicromgrFlagRecord(
        id=str(row["id"]),
        task_id=str(row["task_id"]),
        worker_id=str(row["worker_id"]),
        submission_id=row.get("submission_id"),
        reason_type=str(row["reason_type"]),
        reason_label=str(row.get("reason_label") or ""),
        details=str(row.get("details") or ""),
        severity=str(row.get("severity") or "medium"),
        status=str(row.get("status") or "open"),
        supervisor_id=row.get("supervisor_id"),
        supervisor_notified_at=row.get("supervisor_notified_at"),
        admin_notified_at=row.get("admin_notified_at"),
        resolved_at=row.get("resolved_at"),
        resolved_by=str(row.get("resolved_by") or ""),
        resolution_note=str(row.get("resolution_note") or ""),
        created_at=str(row["created_at"]),
        updated_at=str(row["updated_at"]),
    )


def _report_from_row(row: dict[str, Any]) -> MicromgrReportRecord:
    return MicromgrReportRecord(
        id=str(row["id"]),
        task_id=str(row["task_id"]),
        period_start=str(row["period_start"]),
        period_end=str(row["period_end"]),
        cycle_key=str(row.get("cycle_key") or ""),
        summary_markdown=str(row.get("summary_markdown") or ""),
        total_submissions=int(row.get("total_submissions") or 0),
        missed_count=int(row.get("missed_count") or 0),
        avg_score=row.get("avg_score"),
        pass_rate=row.get("pass_rate"),
        delivered_at=row.get("delivered_at"),
        delivered_to=_json_loads(row.get("delivered_to_json"), {}) or {},
        created_at=str(row["created_at"]),
    )


def _get_task_row(agent_id: str, task_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM micromgr_tasks WHERE id = ? AND workflow_agent_id = ?",
        (task_id, agent_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Task not found.")
    return row


def _get_worker_row(agent_id: str, worker_id: str) -> dict[str, Any]:
    row = db.fetch_one(
        "SELECT * FROM micromgr_workers WHERE id = ? AND workflow_agent_id = ?",
        (worker_id, agent_id),
    )
    if not row:
        raise HTTPException(status_code=404, detail="Worker not found.")
    return row


def _submission_items(submission_id: str) -> list[dict[str, Any]]:
    rows = db.fetch_all(
        "SELECT * FROM micromgr_submission_items WHERE submission_id = ? ORDER BY sort_order ASC",
        (submission_id,),
    )
    return [
        {
            "id": str(row["id"]),
            "label": str(row["label"]),
            "sort_order": int(row["sort_order"] or 0),
            "evidence_type": str(row.get("evidence_type") or ""),
            "image_url": str(row.get("image_url") or ""),
            "raw_message": str(row.get("raw_message") or ""),
            "received_at": row.get("received_at"),
        }
        for row in rows
    ]


def _task_brief(task: dict[str, Any]) -> str:
    parts: list[str] = []
    description = str(task.get("description") or "").strip()
    if description:
        parts.append(f"About this task: {description}")
    items = _json_loads(task.get("required_items_json"), [])
    if isinstance(items, list) and items:
        lines = []
        for index, item in enumerate(items, start=1):
            if not isinstance(item, dict):
                continue
            label = str(item.get("label") or f"Item {index}")
            evidence = str(item.get("evidenceType") or item.get("evidence_type") or task.get("evidence_type") or "PHOTO")
            lines.append(f"  {index}. {label} ({evidence.lower()})")
        if lines:
            parts.append("What to submit each round:\n" + "\n".join(lines))
            parts.append("Send each item one at a time in order. I will guide you through them.")
    else:
        parts.append(f"Evidence type: {str(task.get('evidence_type') or 'PHOTO').lower()}")
    rules = _string_list(_json_loads(task.get("acceptance_rules_json"), []))
    if rules:
        parts.append("Acceptance criteria:\n" + "\n".join(f"  {index}. {rule}" for index, rule in enumerate(rules, start=1)))
    times = _string_list(_json_loads(task.get("scheduled_times_json"), []))
    tz_name = str(task.get("timezone") or "UTC")
    if times:
        parts.append(f"Schedule: {', '.join(times)} ({tz_name})")
    passing = int(task.get("passing_score") or 70)
    parts.append(f"Passing score: {passing}/100")
    if task.get("resubmission_allowed"):
        parts.append("Resubmission: allowed if you do not pass on the first try.")
    return "\n\n".join(parts)


def _onboarding_message(worker: dict[str, Any], task: dict[str, Any]) -> str:
    role = str(worker.get("role") or "worker")
    name = str(worker["name"])
    task_name = str(task["name"])
    brief = _task_brief(task)
    if role == "supervisor":
        return (
            f"Hi {name}, I'm Isaac. You've been added as a supervisor on \"{task_name}\".\n\n"
            f"{brief}\n\n"
            "When a worker misses a deadline or is flagged, I'll message you here so you can follow up. "
            "Reply Ready to confirm you're set up."
        )
    if role == "admin":
        return (
            f"Hi {name}, I'm Isaac. You've been added as an admin on \"{task_name}\".\n\n"
            f"{brief}\n\n"
            "If a supervisor doesn't respond in time after a flag, I'll escalate to you. "
            "Reply Ready to confirm you're set up."
        )
    return (
        f"Hi {name}, my name is Isaac. I'll be managing your task submissions.\n\n"
        f"You've been assigned to: \"{task_name}\"\n\n"
        f"{brief}\n\n"
        "Send help at any time for a reminder of these details.\n\n"
        "When you understand and are ready to start, reply with Ready."
    )


def _outbound_fingerprint(platform: str, connection_id: str, destination: str, message: str) -> str:
    raw = "|".join(
        (
            platform.strip().lower(),
            (connection_id or "default").strip(),
            destination.strip(),
            message.strip(),
        )
    )
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _claim_outbound(platform: str, connection_id: str, destination: str, message: str) -> bool:
    fingerprint = _outbound_fingerprint(platform, connection_id, destination, message)
    now = datetime.now(timezone.utc)
    existing = db.fetch_one("SELECT sent_at FROM micromgr_outbound WHERE fingerprint = ?", (fingerprint,))
    if existing:
        sent_at = _parse_dt(str(existing.get("sent_at") or ""))
        if sent_at and now - sent_at < _OUTBOUND_DEDUP_WINDOW:
            logger.info("Skipping duplicate micromgr send to %s/%s", platform, destination)
            return False
        db.execute("UPDATE micromgr_outbound SET sent_at = ? WHERE fingerprint = ?", (now_iso(), fingerprint))
        return True
    try:
        db.execute(
            "INSERT INTO micromgr_outbound (fingerprint, platform, destination, sent_at) VALUES (?, ?, ?, ?)",
            (fingerprint, platform.strip().lower(), destination.strip(), now_iso()),
        )
    except Exception:
        logger.info("Skipping duplicate micromgr send to %s/%s", platform, destination)
        return False
    return True


def _clear_outbound(platform: str, destination: str) -> None:
    db.execute(
        "DELETE FROM micromgr_outbound WHERE platform = ? AND destination = ?",
        (platform.strip().lower(), destination.strip()),
    )


async def _send(
    workspace: Workspace,
    profile: AgentProfile,
    *,
    platform: str,
    connection_id: str,
    destination: str,
    message: str,
) -> bool:
    if not destination.strip() or not message.strip():
        return False
    if not _claim_outbound(platform, connection_id, destination, message):
        return False
    try:
        await send_message_via_dashboard(
            workspace,
            profile,
            platform=platform,
            connection_id=connection_id or "default",
            destination=destination,
            message=message,
        )
        return True
    except Exception as exc:
        logger.warning("Micro-manager send failed (%s/%s): %s", platform, destination, exc)
        return False


async def _send_onboarding(
    workspace: Workspace,
    profile: AgentProfile,
    worker: dict[str, Any],
    task: dict[str, Any],
) -> None:
    if str(worker.get("onboarding_sent_at") or "").strip():
        return
    await _send(
        workspace,
        profile,
        platform=str(worker.get("platform") or ""),
        connection_id=str(worker.get("connection_id") or ""),
        destination=str(worker.get("external_id") or ""),
        message=_onboarding_message(worker, task),
    )
    db.execute(
        "UPDATE micromgr_workers SET onboarding_sent_at = ?, updated_at = ? WHERE id = ? AND (onboarding_sent_at IS NULL OR onboarding_sent_at = '')",
        (now_iso(), now_iso(), worker["id"]),
    )


def list_tasks(workspace: Workspace, profile: AgentProfile, agent_id: str) -> MicromgrTasksResponse:
    require_micromgr_agent(workspace, profile, agent_id)
    rows = db.fetch_all(
        "SELECT * FROM micromgr_tasks WHERE workflow_agent_id = ? ORDER BY created_at DESC",
        (agent_id,),
    )
    return MicromgrTasksResponse(tasks=[_task_from_row(row) for row in rows], total=len(rows))


def create_task(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: MicromgrTaskCreateRequest,
) -> MicromgrTaskRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    created_at = now_iso()
    task_id = new_id("micromgr_task")
    db.execute(
        """
        INSERT INTO micromgr_tasks (
            id, tenant_id, workspace_id, workflow_agent_id, name, description, evidence_type,
            recurrence_type, recurrence_interval, scheduled_times_json, timezone, acceptance_rules_json,
            sample_evidence_url, required_items_json, scoring_enabled, passing_score, grace_minutes,
            resubmission_allowed, report_time, report_frequency, report_day_of_week, report_day_of_month,
            shift_enabled, escalation_timeout_min, delivery_config_json, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?)
        """,
        (
            task_id,
            workspace.tenant_id,
            workspace.id,
            agent_id,
            payload.name.strip(),
            payload.description.strip(),
            payload.evidence_type,
            payload.recurrence_type,
            payload.recurrence_interval,
            _json_dumps(payload.scheduled_times),
            payload.timezone.strip() or "UTC",
            _json_dumps(payload.acceptance_rules),
            payload.sample_evidence_url.strip(),
            _json_dumps(payload.required_items),
            1 if payload.scoring_enabled else 0,
            payload.passing_score,
            payload.grace_minutes,
            1 if payload.resubmission_allowed else 0,
            payload.report_time,
            payload.report_frequency,
            payload.report_day_of_week,
            payload.report_day_of_month,
            1 if payload.shift_enabled else 0,
            payload.escalation_timeout_min,
            _json_dumps(payload.delivery_config),
            created_at,
            created_at,
        ),
    )
    return _task_from_row(_get_task_row(agent_id, task_id))


def update_task(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    task_id: str,
    payload: MicromgrTaskUpdateRequest,
) -> MicromgrTaskRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    current = _task_from_row(_get_task_row(agent_id, task_id))
    data = payload.model_dump(exclude_unset=True)
    if "status" in data and str(data["status"]) not in TASK_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid task status.")
    merged = current.model_copy(update=data)
    db.execute(
        """
        UPDATE micromgr_tasks SET
            name = ?, description = ?, evidence_type = ?, recurrence_type = ?, recurrence_interval = ?,
            scheduled_times_json = ?, timezone = ?, acceptance_rules_json = ?, sample_evidence_url = ?,
            required_items_json = ?, scoring_enabled = ?, passing_score = ?, grace_minutes = ?,
            resubmission_allowed = ?, report_time = ?, report_frequency = ?, report_day_of_week = ?,
            report_day_of_month = ?, shift_enabled = ?, escalation_timeout_min = ?, delivery_config_json = ?,
            status = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged.name,
            merged.description,
            merged.evidence_type,
            merged.recurrence_type,
            merged.recurrence_interval,
            _json_dumps(merged.scheduled_times),
            merged.timezone,
            _json_dumps(merged.acceptance_rules),
            merged.sample_evidence_url,
            _json_dumps(merged.required_items),
            1 if merged.scoring_enabled else 0,
            merged.passing_score,
            merged.grace_minutes,
            1 if merged.resubmission_allowed else 0,
            merged.report_time,
            merged.report_frequency,
            merged.report_day_of_week,
            merged.report_day_of_month,
            1 if merged.shift_enabled else 0,
            merged.escalation_timeout_min,
            _json_dumps(merged.delivery_config),
            merged.status,
            now_iso(),
            task_id,
        ),
    )
    return _task_from_row(_get_task_row(agent_id, task_id))


def delete_task(workspace: Workspace, profile: AgentProfile, agent_id: str, task_id: str) -> dict[str, bool]:
    require_micromgr_agent(workspace, profile, agent_id)
    _get_task_row(agent_id, task_id)
    db.execute("DELETE FROM micromgr_tasks WHERE id = ?", (task_id,))
    return {"ok": True}


def list_workers(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    task_id: str = "",
) -> MicromgrWorkersResponse:
    require_micromgr_agent(workspace, profile, agent_id)
    if task_id:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_workers WHERE workflow_agent_id = ? AND task_id = ? ORDER BY created_at ASC",
            (agent_id, task_id),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_workers WHERE workflow_agent_id = ? ORDER BY created_at ASC",
            (agent_id,),
        )
    return MicromgrWorkersResponse(workers=[_worker_from_row(row) for row in rows], total=len(rows))


async def add_worker(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    payload: MicromgrWorkerCreateRequest,
) -> MicromgrWorkerRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    task = _get_task_row(agent_id, payload.task_id)
    if str(task.get("status") or "") == "PAUSED":
        raise HTTPException(status_code=400, detail="Resume the task before adding members.")
    if str(task.get("status") or "") == "ARCHIVED":
        raise HTTPException(status_code=400, detail="Cannot add members to an archived task.")
    platform = payload.platform.strip().lower()
    if platform not in PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported messaging platform.")
    role = payload.role.strip().lower() or "worker"
    if role not in WORKER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid worker role.")
    existing = db.fetch_one(
        "SELECT id FROM micromgr_workers WHERE task_id = ? AND platform = ? AND external_id = ?",
        (payload.task_id, platform, payload.external_id.strip()),
    )
    if existing:
        raise HTTPException(status_code=409, detail="That member is already on this task.")
    created_at = now_iso()
    worker_id = new_id("micromgr_worker")
    db.execute(
        """
        INSERT INTO micromgr_workers (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, name, platform, external_id,
            connection_id, role, shift_start, shift_end, status, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'onboarding', ?, ?)
        """,
        (
            worker_id,
            workspace.tenant_id,
            workspace.id,
            agent_id,
            payload.task_id,
            payload.name.strip(),
            platform,
            payload.external_id.strip(),
            payload.connection_id.strip(),
            role,
            payload.shift_start,
            payload.shift_end,
            created_at,
            created_at,
        ),
    )
    worker = _get_worker_row(agent_id, worker_id)
    await _send_onboarding(workspace, profile, worker, task)
    return _worker_from_row(_get_worker_row(agent_id, worker_id))


def update_worker(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    worker_id: str,
    payload: MicromgrWorkerUpdateRequest,
) -> MicromgrWorkerRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    current = _worker_from_row(_get_worker_row(agent_id, worker_id))
    data = payload.model_dump(exclude_unset=True)
    if "role" in data and str(data["role"]).lower() not in WORKER_ROLES:
        raise HTTPException(status_code=400, detail="Invalid worker role.")
    if "status" in data:
        data["status"] = str(data["status"]).lower()
    merged = current.model_copy(update=data)
    db.execute(
        """
        UPDATE micromgr_workers SET
            name = ?, role = ?, shift_start = ?, shift_end = ?, status = ?, connection_id = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            merged.name,
            merged.role,
            merged.shift_start,
            merged.shift_end,
            merged.status,
            merged.connection_id,
            now_iso(),
            worker_id,
        ),
    )
    return _worker_from_row(_get_worker_row(agent_id, worker_id))


def delete_worker(workspace: Workspace, profile: AgentProfile, agent_id: str, worker_id: str) -> dict[str, bool]:
    require_micromgr_agent(workspace, profile, agent_id)
    _get_worker_row(agent_id, worker_id)
    db.execute("DELETE FROM micromgr_workers WHERE id = ?", (worker_id,))
    return {"ok": True}


def list_liveboard(workspace: Workspace, profile: AgentProfile, agent_id: str, task_id: str = "") -> MicromgrLiveboardResponse:
    require_micromgr_agent(workspace, profile, agent_id)
    params: list[Any] = [agent_id]
    where = "workflow_agent_id = ?"
    if task_id:
        where += " AND task_id = ?"
        params.append(task_id)
    submissions = db.fetch_all(
        f"SELECT * FROM micromgr_submissions WHERE {where} ORDER BY due_at DESC LIMIT 200",
        tuple(params),
    )
    workers = {row["id"]: row for row in db.fetch_all("SELECT * FROM micromgr_workers WHERE workflow_agent_id = ?", (agent_id,))}
    tasks = {row["id"]: row for row in db.fetch_all("SELECT * FROM micromgr_tasks WHERE workflow_agent_id = ?", (agent_id,))}
    records = []
    for row in submissions:
        worker = workers.get(row["worker_id"]) or {}
        task = tasks.get(row["task_id"]) or {}
        record = _submission_from_row(row)
        records.append(
            record.model_copy(
                update={
                    "worker_name": str(worker.get("name") or ""),
                    "task_name": str(task.get("name") or ""),
                    "platform": str(worker.get("platform") or ""),
                }
            )
        )
    counts = {"pending": 0, "collecting": 0, "submitted": 0, "approved": 0, "rejected": 0, "missed": 0, "vetted": 0}
    for item in records:
        counts[item.status] = counts.get(item.status, 0) + 1
    return MicromgrLiveboardResponse(submissions=records, counts=counts, total=len(records))


def list_flags(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    status: str = "",
) -> MicromgrFlagsResponse:
    require_micromgr_agent(workspace, profile, agent_id)
    if status:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_flags WHERE workflow_agent_id = ? AND status = ? ORDER BY created_at DESC",
            (agent_id, status),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_flags WHERE workflow_agent_id = ? ORDER BY created_at DESC",
            (agent_id,),
        )
    return MicromgrFlagsResponse(flags=[_flag_from_row(row) for row in rows], total=len(rows))


def update_flag(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    flag_id: str,
    *,
    status: str,
    note: str = "",
) -> MicromgrFlagRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    if status not in {"resolved", "dismissed", "open"}:
        raise HTTPException(status_code=400, detail="Invalid flag status.")
    row = db.fetch_one("SELECT * FROM micromgr_flags WHERE id = ? AND workflow_agent_id = ?", (flag_id, agent_id))
    if not row:
        raise HTTPException(status_code=404, detail="Flag not found.")
    now = now_iso()
    db.execute(
        """
        UPDATE micromgr_flags SET status = ?, resolved_at = ?, resolved_by = ?, resolution_note = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, now if status != "open" else None, "manager" if status != "open" else "", note, now, flag_id),
    )
    _refresh_worker_risk(str(row["worker_id"]))
    return _flag_from_row(db.fetch_one("SELECT * FROM micromgr_flags WHERE id = ?", (flag_id,)) or row)


def list_reports(workspace: Workspace, profile: AgentProfile, agent_id: str, task_id: str = "") -> MicromgrReportsResponse:
    require_micromgr_agent(workspace, profile, agent_id)
    if task_id:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_reports WHERE workflow_agent_id = ? AND task_id = ? ORDER BY created_at DESC",
            (agent_id, task_id),
        )
    else:
        rows = db.fetch_all(
            "SELECT * FROM micromgr_reports WHERE workflow_agent_id = ? ORDER BY created_at DESC",
            (agent_id,),
        )
    return MicromgrReportsResponse(reports=[_report_from_row(row) for row in rows], total=len(rows))


async def trigger_report(
    workspace: Workspace,
    profile: AgentProfile,
    agent_id: str,
    task_id: str,
) -> MicromgrReportRecord:
    require_micromgr_agent(workspace, profile, agent_id)
    task = _get_task_row(agent_id, task_id)
    now = datetime.now(timezone.utc)
    report = await _generate_report(workspace, profile, task, now, force=True)
    if not report:
        raise HTTPException(status_code=409, detail="Could not generate a report for this task.")
    return report


def manager_context_block(agent_id: str) -> str:
    tasks = db.fetch_all("SELECT id, name, status FROM micromgr_tasks WHERE workflow_agent_id = ? ORDER BY created_at DESC", (agent_id,))
    workers = db.fetch_all(
        "SELECT name, role, status, platform FROM micromgr_workers WHERE workflow_agent_id = ? ORDER BY created_at DESC LIMIT 40",
        (agent_id,),
    )
    flags = db.fetch_all(
        "SELECT reason_label, status FROM micromgr_flags WHERE workflow_agent_id = ? AND status = 'open' ORDER BY created_at DESC LIMIT 20",
        (agent_id,),
    )
    lines = ["## Current operations snapshot", "Use the Tasks, Workers, Liveboard, Flags, and Reports tabs to mutate data. Summarize this snapshot when the manager asks how the operation is going."]
    if not tasks:
        lines.append("No tasks created yet.")
        return "\n".join(lines)
    lines.append("Tasks:")
    for task in tasks:
        lines.append(f"- {task['name']} ({task['status']})")
    if workers:
        lines.append("Members:")
        for worker in workers:
            lines.append(f"- {worker['name']} / {worker['role']} / {worker['status']} / {worker['platform']}")
    lines.append(f"Open flags: {len(flags)}")
    return "\n".join(lines)


def _reply_from_input(run_input: dict[str, Any]) -> dict[str, str]:
    payload = run_input.get("payload") if isinstance(run_input.get("payload"), dict) else run_input
    if not isinstance(payload, dict):
        payload = {}
    nested = payload.get("input") if isinstance(payload.get("input"), dict) else {}
    reply = payload.get("reply_to_source") if isinstance(payload.get("reply_to_source"), dict) else {}
    return {
        "channel": str(reply.get("channel") or payload.get("channel") or "").strip().lower(),
        "connection_id": str(reply.get("connection_id") or payload.get("connection_id") or "").strip(),
        "conversation_id": str(reply.get("conversation_id") or payload.get("conversation_id") or "").strip(),
        "sender_id": str(reply.get("sender_id") or payload.get("sender_id") or "").strip(),
        "thread_id": str(reply.get("thread_id") or payload.get("thread_id") or "").strip(),
        "sender_name": str(payload.get("sender_name") or "").strip(),
        "image_url": _first_media_url(payload, nested),
    }


def _is_ready_message(text: str) -> bool:
    return bool(re.fullmatch(r"ready[.!]?", (text or "").strip().lower()))


def _image_prompt_label(url: str) -> str:
    value = (url or "").strip()
    if not value:
        return "(none)"
    if value.startswith(("data:", "attached:")):
        return "(attached)"
    lowered = value.lower()
    if not value.startswith("http") and lowered.rsplit(".", 1)[-1] in {"bmp", "gif", "jpeg", "jpg", "png", "webp"}:
        return "(attached)"
    return value


def _collect_image_urls(*values: Any) -> list[str]:
    urls: list[str] = []
    seen: set[str] = set()
    for value in values:
        candidates = value if isinstance(value, list) else [value]
        for item in candidates:
            url = str(item or "").strip()
            if not url or url.startswith("attached:") or url in seen:
                continue
            seen.add(url)
            urls.append(url)
    return urls


def _first_media_url(payload: dict[str, Any], nested: dict[str, Any]) -> str:
    for source in (payload, nested):
        direct = str(source.get("image_url") or source.get("media_url") or "").strip()
        if direct:
            return direct
        urls = source.get("media_urls")
        if isinstance(urls, list):
            for item in urls:
                value = str(item or "").strip()
                if value:
                    return value
        elif isinstance(urls, str) and urls.strip():
            return urls.strip()
    return ""


def _lookup_workers(agent_id: str, platform: str, sender_id: str) -> list[dict[str, Any]]:
    if not sender_id:
        return []
    candidates = [sender_id, sender_id.lstrip("@")]
    rows: list[dict[str, Any]] = []
    seen: set[str] = set()
    for candidate in candidates:
        found = db.fetch_all(
            """
            SELECT * FROM micromgr_workers
            WHERE workflow_agent_id = ? AND platform = ? AND external_id = ?
              AND status IN ('onboarding', 'active')
            ORDER BY created_at ASC
            """,
            (agent_id, platform, candidate),
        )
        for row in found:
            if row["id"] in seen:
                continue
            seen.add(str(row["id"]))
            rows.append(row)
    return rows


async def maybe_handle_micromgr_message(
    workspace: Workspace,
    profile: AgentProfile,
    agent: WorkflowAgentRecord,
    *,
    message: str,
    conversation_id: str,
    trigger_type: str,
    run_input: dict[str, Any],
) -> str | None:
    if trigger_type != "chat":
        return None
    reply = _reply_from_input(run_input)
    platform = reply.get("channel") or ""
    sender_id = reply.get("sender_id") or conversation_id
    if platform not in PLATFORMS or not sender_id:
        return None
    workers = _lookup_workers(agent.id, platform, sender_id)
    if not workers:
        return None
    text = (message or "").strip()
    lowered = text.lower()
    image_url = reply.get("image_url") or ""

    help_worker = workers[0]
    if _is_ready_message(text):
        onboard = [row for row in workers if str(row.get("status")) == "onboarding"]
        if onboard:
            now = now_iso()
            replies = []
            for worker in onboard:
                db.execute(
                    "UPDATE micromgr_workers SET status = 'active', onboarded_at = ?, updated_at = ? WHERE id = ?",
                    (now, now, worker["id"]),
                )
                task = db.fetch_one("SELECT * FROM micromgr_tasks WHERE id = ?", (worker["task_id"],)) or {}
                role = str(worker.get("role") or "worker")
                task_name = str(task.get("name") or "this task")
                if role == "supervisor":
                    replies.append(f"Great, {worker['name']}! You're now active as a supervisor on \"{task_name}\".")
                elif role == "admin":
                    replies.append(f"Great, {worker['name']}! You're now active as an admin on \"{task_name}\".")
                else:
                    replies.append(
                        f"Great, {worker['name']}! You're now active on \"{task_name}\". "
                        "You'll receive task prompts at the scheduled times."
                    )
            return "\n\n".join(replies)
        return (
            f"Hi {help_worker['name']}, you're already onboarded. "
            "I'll message you when a task is due. Send help for task details."
        )

    if lowered == "help":
        task = db.fetch_one("SELECT * FROM micromgr_tasks WHERE id = ?", (help_worker["task_id"],)) or {}
        pending = db.fetch_one(
            """
            SELECT * FROM micromgr_submissions
            WHERE worker_id = ? AND status IN ('pending', 'collecting', 'rejected')
            ORDER BY due_at ASC
            """,
            (help_worker["id"],),
        )
        pending_info = "No pending submissions right now."
        if pending:
            pending_info = f"You have a pending submission due at {pending['due_at']}."
        return (
            f"Hi {help_worker['name']}, here are your task details for \"{task.get('name')}\":\n\n"
            f"{_task_brief(task)}\n\n"
            f"Current status: {pending_info}"
        )

    onboard = [row for row in workers if str(row.get("status")) == "onboarding"]
    if onboard:
        return (
            f"Hi {onboard[0]['name']}, please reply with Ready to confirm you're set up and start receiving tasks. "
            "Send help for task details."
        )

    supervisors = [row for row in workers if str(row.get("role")) in {"supervisor", "admin"} and str(row.get("status")) == "active"]
    if supervisors and re.fullmatch(r"(done|resolved|handled|fixed)[.!]?", lowered):
        flag = db.fetch_one(
            """
            SELECT * FROM micromgr_flags
            WHERE workflow_agent_id = ? AND status = 'open' AND task_id = ?
            ORDER BY created_at ASC
            """,
            (agent.id, supervisors[0]["task_id"]),
        )
        if flag:
            db.execute(
                """
                UPDATE micromgr_flags SET status = 'resolved', resolved_at = ?, resolved_by = ?, resolution_note = ?, updated_at = ?
                WHERE id = ?
                """,
                (now_iso(), str(supervisors[0]["id"]), text, now_iso(), flag["id"]),
            )
            _refresh_worker_risk(str(flag["worker_id"]))
            return f"Thanks {supervisors[0]['name']}. I marked that flag resolved."
        return f"Hi {supervisors[0]['name']}, there are no open flags on this task right now."

    active_workers = [row for row in workers if str(row.get("role")) == "worker" and str(row.get("status")) == "active"]
    if not active_workers:
        return None
    return await _handle_submission(workspace, profile, active_workers[0], text, image_url)


async def _handle_submission(
    workspace: Workspace,
    profile: AgentProfile,
    worker: dict[str, Any],
    text: str,
    image_url: str,
) -> str:
    task = db.fetch_one("SELECT * FROM micromgr_tasks WHERE id = ?", (worker["task_id"],)) or {}
    status = str(task.get("status") or "ACTIVE")
    if status == "ARCHIVED":
        return f"Hi {worker['name']}, \"{task.get('name')}\" is archived. You cannot submit evidence right now."
    if status == "PAUSED":
        return f"Hi {worker['name']}, \"{task.get('name')}\" is paused. You cannot submit evidence until it resumes."

    pending = db.fetch_one(
        """
        SELECT * FROM micromgr_submissions
        WHERE worker_id = ? AND status IN ('pending', 'collecting', 'rejected')
        ORDER BY due_at ASC
        """,
        (worker["id"],),
    )
    if pending:
        due = _parse_dt(str(pending.get("due_at") or ""))
        grace = int(task.get("grace_minutes") or 15)
        if due and datetime.now(timezone.utc) > due + timedelta(minutes=grace):
            db.execute(
                "UPDATE micromgr_submissions SET status = 'missed', updated_at = ? WHERE id = ? AND status IN ('pending', 'collecting', 'rejected')",
                (now_iso(), pending["id"]),
            )
            await _flag_missed(workspace, profile, task, worker, pending)
            pending = db.fetch_one(
                """
                SELECT * FROM micromgr_submissions
                WHERE worker_id = ? AND status IN ('pending', 'collecting', 'rejected')
                ORDER BY due_at ASC
                """,
                (worker["id"],),
            )

    if not pending:
        times = _string_list(_json_loads(task.get("scheduled_times_json"), []))
        tz_name = str(task.get("timezone") or "UTC")
        return (
            f"Hi {worker['name']},\n\nThere isn't an open submission for \"{task.get('name')}\" right now. "
            f"You'll be notified around: {', '.join(times) or 'the next scheduled time'} ({tz_name})."
        )

    evidence = str(task.get("evidence_type") or "PHOTO").upper()
    if evidence in {"PHOTO", "VIDEO"} and not image_url:
        kind = "photo" if evidence == "PHOTO" else "video"
        return (
            f"Hi {worker['name']}, \"{task.get('name')}\" needs a {kind}. "
            f"Please send your {kind} in this chat and I'll review it."
        )

    items = db.fetch_all(
        "SELECT * FROM micromgr_submission_items WHERE submission_id = ? ORDER BY sort_order ASC",
        (pending["id"],),
    )
    if str(pending.get("status")) == "rejected" and items:
        db.execute(
            "UPDATE micromgr_submission_items SET image_url = '', raw_message = '', received_at = NULL WHERE submission_id = ?",
            (pending["id"],),
        )
        db.execute(
            "UPDATE micromgr_submissions SET status = 'pending', ai_score = NULL, ai_findings_json = '[]', ai_feedback = '', submitted_at = NULL, updated_at = ? WHERE id = ?",
            (now_iso(), pending["id"]),
        )
        items = db.fetch_all(
            "SELECT * FROM micromgr_submission_items WHERE submission_id = ? ORDER BY sort_order ASC",
            (pending["id"],),
        )

    now = now_iso()
    if not items:
        db.execute(
            """
            UPDATE micromgr_submissions SET status = 'submitted', submitted_at = ?, image_url = ?, raw_message = ?, updated_at = ?
            WHERE id = ?
            """,
            (now, image_url, text, now, pending["id"]),
        )
        return await _vet_submission(workspace, profile, str(pending["id"]))

    next_item = next((item for item in items if not item.get("received_at")), None)
    if not next_item:
        return f"Thanks {worker['name']}, your submission has been received!"
    db.execute(
        "UPDATE micromgr_submission_items SET image_url = ?, raw_message = ?, received_at = ? WHERE id = ?",
        (image_url, text, now, next_item["id"]),
    )
    remaining = [item for item in items if item["id"] != next_item["id"] and not item.get("received_at")]
    received = len(items) - len(remaining)
    db.execute(
        "UPDATE micromgr_submissions SET status = ?, image_url = ?, raw_message = ?, updated_at = ? WHERE id = ?",
        ("collecting" if remaining else "submitted", image_url or str(pending.get("image_url") or ""), text, now, pending["id"]),
    )
    if remaining:
        return f"{next_item['label']} received ({received}/{len(items)}). Now send your {remaining[0]['label']}."
    db.execute("UPDATE micromgr_submissions SET submitted_at = ?, updated_at = ? WHERE id = ?", (now, now, pending["id"]))
    return await _vet_submission(workspace, profile, str(pending["id"]))


def _parse_vetting(text: str, passing_score: int) -> dict[str, Any]:
    match = re.search(r"\{[\s\S]*\}", text or "")
    if not match:
        return {"score": 50, "passed": 50 >= passing_score, "findings": [], "summary": "Evaluation completed."}
    try:
        parsed = json.loads(re.sub(r",\s*([\]}])", r"\1", match.group(0)))
    except json.JSONDecodeError:
        return {"score": 50, "passed": 50 >= passing_score, "findings": [], "summary": "Evaluation completed."}
    score = int(parsed.get("score") if isinstance(parsed.get("score"), (int, float)) else 50)
    passed = bool(parsed.get("passed")) if isinstance(parsed.get("passed"), bool) else score >= passing_score
    findings = parsed.get("findings") if isinstance(parsed.get("findings"), list) else []
    summary = str(parsed.get("summary") or "Evaluation completed.")
    return {"score": score, "passed": passed, "findings": [str(item) for item in findings], "summary": summary}


async def _vet_submission(workspace: Workspace, profile: AgentProfile, submission_id: str) -> str:
    submission = db.fetch_one("SELECT * FROM micromgr_submissions WHERE id = ?", (submission_id,))
    if not submission:
        return "Thanks, your submission has been received."
    task = db.fetch_one("SELECT * FROM micromgr_tasks WHERE id = ?", (submission["task_id"],)) or {}
    worker = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (submission["worker_id"],)) or {}
    items = _submission_items(submission_id)
    passing = int(task.get("passing_score") or 70)
    rules = _string_list(_json_loads(task.get("acceptance_rules_json"), []))
    rules_text = "\n".join(f"{index}. {rule}" for index, rule in enumerate(rules, start=1)) or "No specific rules defined. Evaluate general quality and completeness."
    prompt_lines = [
        f"Task: {task.get('name')}",
        f"Passing score: {passing}",
        f"Acceptance rules:\n{rules_text}",
    ]
    images = _collect_image_urls(
        [item.get("image_url") for item in items],
        submission.get("image_url"),
    )
    if items:
        for item in items:
            prompt_lines.append(
                f"Item {item['label']}: text={item['raw_message'] or '(none)'} image={_image_prompt_label(str(item.get('image_url') or ''))}"
            )
    else:
        prompt_lines.append(f"Text: {submission.get('raw_message') or '(none)'}")
        prompt_lines.append(f"Image: {_image_prompt_label(str(submission.get('image_url') or ''))}")
    if images:
        prompt_lines.append(f"Attached images: {len(images)}. Look at every attached image before scoring.")
    db.execute(
        "UPDATE micromgr_submissions SET vet_attempts = vet_attempts + 1, updated_at = ? WHERE id = ?",
        (now_iso(), submission_id),
    )
    raw = await run_agent_via_dashboard(
        workspace,
        profile,
        "\n".join(prompt_lines),
        instructions=VETTING_INSTRUCTIONS,
        images=images,
    )
    result = _parse_vetting(raw, passing)
    status = "approved" if result["passed"] else "rejected"
    feedback_parts = [f"Score: {result['score']}/100. {'Passed' if result['passed'] else 'Did not pass'}."]
    if result["summary"]:
        feedback_parts.append(result["summary"])
    if result["findings"]:
        feedback_parts.extend(f"- {item}" for item in result["findings"] if str(item).strip())
    if not result["passed"] and task.get("resubmission_allowed"):
        feedback_parts.append("Please try again and send a new submission.")
    feedback = "\n\n".join(feedback_parts)
    db.execute(
        """
        UPDATE micromgr_submissions SET status = ?, ai_score = ?, ai_findings_json = ?, ai_feedback = ?, updated_at = ?
        WHERE id = ?
        """,
        (status, result["score"], _json_dumps(result["findings"]), feedback, now_iso(), submission_id),
    )
    if not result["passed"]:
        await _create_flag(
            workspace,
            profile,
            task,
            worker,
            submission,
            reason_type="low_score",
            reason_label="Low score",
            details=feedback,
            severity="medium" if result["score"] >= passing / 2 else "high",
        )
    return feedback


def _refresh_worker_risk(worker_id: str) -> None:
    open_flags = db.fetch_all("SELECT * FROM micromgr_flags WHERE worker_id = ? AND status = 'open'", (worker_id,))
    total = db.fetch_one("SELECT COUNT(*) AS n FROM micromgr_flags WHERE worker_id = ?", (worker_id,))
    count = len(open_flags)
    if count >= 4:
        risk = "critical"
    elif count >= 2:
        risk = "at_risk"
    elif count == 1:
        risk = "watchlist"
    else:
        risk = "healthy"
    latest = open_flags[0] if open_flags else None
    db.execute(
        """
        UPDATE micromgr_workers SET active_flag_count = ?, total_flag_count = ?, last_flagged_at = ?, last_flag_reason = ?,
            risk_level = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            count,
            int((total or {}).get("n") or 0),
            latest.get("created_at") if latest else None,
            latest.get("reason_label") if latest else None,
            risk,
            now_iso(),
            worker_id,
        ),
    )


async def _create_flag(
    workspace: Workspace,
    profile: AgentProfile,
    task: dict[str, Any],
    worker: dict[str, Any],
    submission: dict[str, Any] | None,
    *,
    reason_type: str,
    reason_label: str,
    details: str,
    severity: str,
) -> dict[str, Any] | None:
    dedupe = f"{worker['id']}:{reason_type}:{str((submission or {}).get('id') or 'none')}"
    existing = db.fetch_one("SELECT * FROM micromgr_flags WHERE dedupe_key = ?", (dedupe,))
    if existing:
        return existing
    created_at = now_iso()
    flag_id = new_id("micromgr_flag")
    db.execute(
        """
        INSERT INTO micromgr_flags (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, worker_id, submission_id,
            reason_type, reason_label, details, severity, status, dedupe_key, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
        """,
        (
            flag_id,
            workspace.tenant_id,
            workspace.id,
            str(task["workflow_agent_id"]),
            str(task["id"]),
            str(worker["id"]),
            str(submission["id"]) if submission else None,
            reason_type,
            reason_label,
            details,
            severity,
            dedupe,
            created_at,
            created_at,
        ),
    )
    _refresh_worker_risk(str(worker["id"]))
    flag = db.fetch_one("SELECT * FROM micromgr_flags WHERE id = ?", (flag_id,))
    if flag:
        await _notify_supervisors(workspace, profile, task, worker, flag)
    return flag


async def _flag_missed(
    workspace: Workspace,
    profile: AgentProfile,
    task: dict[str, Any],
    worker: dict[str, Any],
    submission: dict[str, Any],
) -> None:
    await _create_flag(
        workspace,
        profile,
        task,
        worker,
        submission,
        reason_type="missed_deadline",
        reason_label="Missed deadline",
        details=f"{worker.get('name')} missed {task.get('name')} due at {submission.get('due_at')}.",
        severity="high",
    )


async def _notify_supervisors(
    workspace: Workspace,
    profile: AgentProfile,
    task: dict[str, Any],
    worker: dict[str, Any],
    flag: dict[str, Any],
) -> None:
    now = datetime.now(timezone.utc)
    supervisors = db.fetch_all(
        "SELECT * FROM micromgr_workers WHERE task_id = ? AND status = 'active' AND role = 'supervisor'",
        (task["id"],),
    )
    if task.get("shift_enabled"):
        on_shift = [row for row in supervisors if _within_shift(now, str(task.get("timezone") or "UTC"), row.get("shift_start"), row.get("shift_end"))]
        supervisors = on_shift or supervisors
    text = (
        f"Hi {supervisors[0]['name'] if supervisors else 'team'}, {worker.get('name')} was flagged on \"{task.get('name')}\": "
        f"{flag.get('reason_label')}. {flag.get('details')}"
    )
    for supervisor in supervisors:
        await _send(
            workspace,
            profile,
            platform=str(supervisor["platform"]),
            connection_id=str(supervisor.get("connection_id") or ""),
            destination=str(supervisor["external_id"]),
            message=text.replace(supervisors[0]["name"] if supervisors else "team", str(supervisor["name"])),
        )
    if supervisors:
        db.execute(
            "UPDATE micromgr_flags SET supervisor_id = ?, supervisor_notified_at = ?, updated_at = ? WHERE id = ?",
            (str(supervisors[0]["id"]), now_iso(), now_iso(), flag["id"]),
        )


async def _escalate_stale_flags(workspace: Workspace, profile: AgentProfile, task: dict[str, Any], now: datetime) -> None:
    timeout = int(task.get("escalation_timeout_min") or 60)
    cutoff = (now - timedelta(minutes=timeout)).isoformat()
    flags = db.fetch_all(
        """
        SELECT * FROM micromgr_flags
        WHERE task_id = ? AND status = 'open' AND supervisor_notified_at IS NOT NULL
          AND supervisor_notified_at <= ? AND admin_notified_at IS NULL
        """,
        (task["id"], cutoff),
    )
    admins = db.fetch_all(
        "SELECT * FROM micromgr_workers WHERE task_id = ? AND status = 'active' AND role = 'admin'",
        (task["id"],),
    )
    if not admins:
        return
    for flag in flags:
        worker = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (flag["worker_id"],)) or {}
        text = (
            f"Escalation on \"{task.get('name')}\": {worker.get('name')} still has an open {flag.get('reason_label')} flag. "
            "A supervisor has not closed it in time."
        )
        for admin in admins:
            await _send(
                workspace,
                profile,
                platform=str(admin["platform"]),
                connection_id=str(admin.get("connection_id") or ""),
                destination=str(admin["external_id"]),
                message=f"Hi {admin['name']}, {text}",
            )
        db.execute(
            "UPDATE micromgr_flags SET admin_notified_at = ?, updated_at = ? WHERE id = ?",
            (now_iso(), now_iso(), flag["id"]),
        )


def _required_items(task: dict[str, Any]) -> list[dict[str, Any]]:
    items = _json_loads(task.get("required_items_json"), [])
    if not isinstance(items, list):
        return []
    normalized = []
    for index, item in enumerate(items):
        if isinstance(item, str) and item.strip():
            normalized.append({"label": item.strip(), "evidence_type": str(task.get("evidence_type") or "PHOTO")})
        elif isinstance(item, dict) and str(item.get("label") or "").strip():
            normalized.append(
                {
                    "label": str(item.get("label")).strip(),
                    "evidence_type": str(item.get("evidenceType") or item.get("evidence_type") or task.get("evidence_type") or "PHOTO"),
                }
            )
        elif item:
            normalized.append({"label": f"Item {index + 1}", "evidence_type": str(task.get("evidence_type") or "PHOTO")})
    return normalized


async def _create_due_submissions(workspace: Workspace, profile: AgentProfile, task: dict[str, Any], now: datetime) -> None:
    times = _string_list(_json_loads(task.get("scheduled_times_json"), []))
    if not times:
        return
    tz_name = str(task.get("timezone") or "UTC")
    local = _zoned_parts(now, tz_name)
    grace = int(task.get("grace_minutes") or 15)
    workers = db.fetch_all(
        "SELECT * FROM micromgr_workers WHERE task_id = ? AND status = 'active' AND role = 'worker'",
        (task["id"],),
    )
    if task.get("shift_enabled"):
        workers = [row for row in workers if _within_shift(now, tz_name, row.get("shift_start"), row.get("shift_end"))]
    for time_str in times:
        parts = _hhmm(time_str)
        if not parts:
            continue
        due = _wall_to_utc(local.year, local.month, local.day, parts[0], parts[1], tz_name)
        reminder_at = due - timedelta(minutes=30)
        window_end = due + timedelta(minutes=grace)
        if now < reminder_at or now > window_end:
            continue
        if str(task.get("recurrence_type") or "DAILY") == "ONCE":
            existing_any = db.fetch_one("SELECT id FROM micromgr_submissions WHERE task_id = ? LIMIT 1", (task["id"],))
            if existing_any:
                continue
        for worker in workers:
            existing = db.fetch_one(
                "SELECT id FROM micromgr_submissions WHERE task_id = ? AND worker_id = ? AND due_at = ?",
                (task["id"], worker["id"], due.isoformat()),
            )
            if existing:
                continue
            created_at = now_iso()
            submission_id = new_id("micromgr_sub")
            db.execute(
                """
                INSERT INTO micromgr_submissions (
                    id, tenant_id, workspace_id, workflow_agent_id, task_id, worker_id, due_at, status, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
                """,
                (
                    submission_id,
                    workspace.tenant_id,
                    workspace.id,
                    str(task["workflow_agent_id"]),
                    str(task["id"]),
                    str(worker["id"]),
                    due.isoformat(),
                    created_at,
                    created_at,
                ),
            )
            items = _required_items(task)
            for index, item in enumerate(items):
                db.execute(
                    """
                    INSERT INTO micromgr_submission_items (id, submission_id, label, sort_order, evidence_type, created_at)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (new_id("micromgr_item"), submission_id, item["label"], index, item["evidence_type"], created_at),
                )
            evidence = str(task.get("evidence_type") or "PHOTO").lower()
            due_label = _format_hhmm(parts[0], parts[1])
            if items:
                list_text = "\n".join(f"  {index}. {item['label']} ({item['evidence_type'].lower()})" for index, item in enumerate(items, start=1))
                prompt = (
                    f"Hi {worker['name']}, your task \"{task['name']}\" is due at {due_label} ({tz_name}).\n\n"
                    f"Please submit the following items:\n{list_text}\n\n"
                    f"Start by sending your {items[0]['label']}."
                )
            else:
                prompt = (
                    f"Hi {worker['name']}, your task \"{task['name']}\" is due at {due_label} ({tz_name}).\n\n"
                    f"Please submit your {evidence} now. Reply with your evidence and I'll review it."
                )
            await _send(
                workspace,
                profile,
                platform=str(worker["platform"]),
                connection_id=str(worker.get("connection_id") or ""),
                destination=str(worker["external_id"]),
                message=prompt,
            )


async def _mark_overdue(workspace: Workspace, profile: AgentProfile, task: dict[str, Any], now: datetime) -> None:
    grace = int(task.get("grace_minutes") or 15)
    cutoff = (now - timedelta(minutes=grace)).isoformat()
    overdue = db.fetch_all(
        """
        SELECT * FROM micromgr_submissions
        WHERE task_id = ? AND status IN ('pending', 'collecting', 'rejected') AND due_at < ?
        """,
        (task["id"], cutoff),
    )
    for submission in overdue:
        db.execute(
            "UPDATE micromgr_submissions SET status = 'missed', updated_at = ? WHERE id = ? AND status IN ('pending', 'collecting', 'rejected')",
            (now_iso(), submission["id"]),
        )
        worker = db.fetch_one("SELECT * FROM micromgr_workers WHERE id = ?", (submission["worker_id"],)) or {}
        await _flag_missed(workspace, profile, task, worker, submission)
        if str(worker.get("status")) == "active":
            due = _parse_dt(str(submission.get("due_at") or ""))
            due_label = due.astimezone(_tz(str(task.get("timezone") or "UTC"))).strftime("%H:%M") if due else ""
            await _send(
                workspace,
                profile,
                platform=str(worker.get("platform") or ""),
                connection_id=str(worker.get("connection_id") or ""),
                destination=str(worker.get("external_id") or ""),
                message=f"Hi {worker.get('name')}, you missed the \"{task.get('name')}\" submission due at {due_label}.",
            )


def _report_window(task: dict[str, Any], now: datetime) -> tuple[datetime, datetime, str] | None:
    tz_name = str(task.get("timezone") or "UTC")
    local = _zoned_parts(now, tz_name)
    freq = str(task.get("report_frequency") or "DAILY").upper()
    start = _wall_to_utc(local.year, local.month, local.day, 0, 0, tz_name)
    end = _wall_to_utc(local.year, local.month, local.day, 23, 59, tz_name)
    key = f"DAILY:{local.date().isoformat()}"
    if freq == "WEEKLY":
        want = int(task.get("report_day_of_week") if task.get("report_day_of_week") is not None else 1)
        if local.isoweekday() != want:
            return None
        start = start - timedelta(days=6)
        key = f"WEEKLY:{local.date().isoformat()}"
    elif freq == "MONTHLY":
        want = int(task.get("report_day_of_month") if task.get("report_day_of_month") is not None else 1)
        if local.day != want:
            return None
        start = _wall_to_utc(local.year, local.month, 1, 0, 0, tz_name)
        key = f"MONTHLY:{local.year:04d}-{local.month:02d}"
    return start, end, key


async def _generate_report(
    workspace: Workspace,
    profile: AgentProfile,
    task: dict[str, Any],
    now: datetime,
    *,
    force: bool = False,
) -> MicromgrReportRecord | None:
    window = _report_window(task, now)
    if not window:
        return None
    start, end, cycle_key = window
    if not force:
        existing = db.fetch_one(
            "SELECT * FROM micromgr_reports WHERE task_id = ? AND cycle_key = ?",
            (task["id"], cycle_key),
        )
        if existing:
            return _report_from_row(existing)
    rows = db.fetch_all(
        """
        SELECT s.*, w.name AS worker_name
        FROM micromgr_submissions s
        JOIN micromgr_workers w ON w.id = s.worker_id
        WHERE s.task_id = ? AND s.due_at >= ? AND s.due_at <= ?
        ORDER BY w.name ASC
        """,
        (task["id"], start.isoformat(), end.isoformat()),
    )
    scores = [int(row["ai_score"]) for row in rows if row.get("ai_score") is not None]
    missed = [row for row in rows if str(row.get("status")) == "missed"]
    approved = [row for row in rows if str(row.get("status")) == "approved"]
    avg_score = round(sum(scores) / len(scores), 1) if scores else None
    pass_rate = round((len(approved) / len(rows)) * 100, 1) if rows else None
    snapshot_lines = [
        f"Task: {task.get('name')}",
        f"Period: {start.isoformat()} to {end.isoformat()}",
        f"Total due: {len(rows)}. Missed: {len(missed)}. Approved: {len(approved)}. Avg score: {avg_score}.",
    ]
    for row in rows:
        snapshot_lines.append(f"- {row.get('worker_name')}: {row.get('status')} score={row.get('ai_score')}")
    markdown = await run_agent_via_dashboard(workspace, profile, "\n".join(snapshot_lines), instructions=REPORT_INSTRUCTIONS)
    created_at = now_iso()
    report_id = new_id("micromgr_report")
    db.execute(
        """
        INSERT INTO micromgr_reports (
            id, tenant_id, workspace_id, workflow_agent_id, task_id, period_start, period_end, cycle_key,
            summary_markdown, total_submissions, missed_count, avg_score, pass_rate, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            report_id,
            workspace.tenant_id,
            workspace.id,
            str(task["workflow_agent_id"]),
            str(task["id"]),
            start.isoformat(),
            end.isoformat(),
            cycle_key,
            markdown.strip(),
            len(rows),
            len(missed),
            avg_score,
            pass_rate,
            created_at,
        ),
    )
    delivered = await _deliver_report(workspace, profile, task, markdown.strip(), start.date().isoformat())
    if delivered:
        db.execute(
            "UPDATE micromgr_reports SET delivered_at = ?, delivered_to_json = ? WHERE id = ?",
            (now_iso(), _json_dumps(delivered), report_id),
        )
    return _report_from_row(db.fetch_one("SELECT * FROM micromgr_reports WHERE id = ?", (report_id,)) or {})


async def _deliver_report(
    workspace: Workspace,
    profile: AgentProfile,
    task: dict[str, Any],
    markdown: str,
    report_date: str,
) -> dict[str, bool]:
    config = _json_loads(task.get("delivery_config_json"), {}) or {}
    destinations = config.get("destinations") if isinstance(config, dict) else []
    if not isinstance(destinations, list):
        destinations = []
    results: dict[str, bool] = {}
    summary = f"{task.get('name')} report for {report_date}\n\n{markdown}"
    for dest in destinations:
        if not isinstance(dest, dict):
            continue
        platform = str(dest.get("platform") or "").strip().lower()
        destination = str(dest.get("destination") or dest.get("channelId") or "").strip()
        if platform not in PLATFORMS or not destination:
            continue
        key = f"{platform}:{destination}"
        results[key] = await _send(
            workspace,
            profile,
            platform=platform,
            connection_id=str(dest.get("connection_id") or dest.get("connectionId") or ""),
            destination=destination,
            message=summary,
        )
    return results


async def _maybe_report(workspace: Workspace, profile: AgentProfile, task: dict[str, Any], now: datetime) -> None:
    report_time = _hhmm(str(task.get("report_time") or "18:00"))
    if not report_time:
        return
    local = _zoned_parts(now, str(task.get("timezone") or "UTC"))
    if local.hour != report_time[0] or abs(local.minute - report_time[1]) > 1:
        return
    await _generate_report(workspace, profile, task, now, force=False)


async def tick_micromgr() -> int:
    tasks = db.fetch_all("SELECT * FROM micromgr_tasks WHERE status = 'ACTIVE'")
    handled = 0
    now = datetime.now(timezone.utc)
    for task in tasks:
        workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (task["workspace_id"],))
        agent_row = db.fetch_one("SELECT * FROM agents WHERE id = (SELECT runtime_agent_id FROM workflow_agents WHERE id = ?)", (task["workflow_agent_id"],))
        if not workspace_row or not agent_row:
            continue
        workspace = Workspace(
            id=str(workspace_row["id"]),
            tenant_id=str(workspace_row["tenant_id"]),
            name=str(workspace_row["name"]),
            slug=str(workspace_row["slug"]),
            kind=str(workspace_row["kind"]),
            plan="local",
            region="local",
        )
        raw_status = str(agent_row.get("status") or "active")
        if raw_status not in {"active", "setup_required", "offline"}:
            raw_status = "active"
        profile = AgentProfile(
            id=str(agent_row["id"]),
            tenant_id=str(agent_row["tenant_id"]),
            workspace_id=str(agent_row["workspace_id"]),
            name=str(agent_row["name"]),
            role=str(agent_row["role"]),
            status=raw_status,
            description=str(agent_row["description"]),
            capabilities=[],
            starters=[],
        )
        await _create_due_submissions(workspace, profile, task, now)
        await _mark_overdue(workspace, profile, task, now)
        await _escalate_stale_flags(workspace, profile, task, now)
        await _maybe_report(workspace, profile, task, now)
        handled += 1
    return handled
