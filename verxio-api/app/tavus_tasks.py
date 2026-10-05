"""HMAC task intake. Tavus returns immediately; the desktop runs the job in Hermes."""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app import db
from app.control_plane import now_iso
from app.device_tokens import arequire_user_or_device
from app.models import new_id
from app.tavus_client import tool_secret

router = APIRouter()


def verify_signature(body: bytes, signature: str) -> bool:
    secret = tool_secret().encode("utf-8")
    if not secret or not signature:
        return False
    expected = hmac.new(secret, body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature.strip())


def accept_task(body: bytes) -> dict[str, str]:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise HTTPException(status_code=400, detail="Task payload must be JSON.") from exc
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Task payload must be an object.")
    tool_call_id = str(payload.get("tool_call_id") or "")
    conversation_id = str(payload.get("conversation_id") or "")
    if not tool_call_id or not conversation_id:
        raise HTTPException(status_code=400, detail="tool_call_id and conversation_id are required.")
    existing = db.fetch_one("SELECT id FROM tavus_tasks WHERE tool_call_id = ?", (tool_call_id,))
    if existing:
        return {"ok": "true", "taskId": str(existing["id"])}
    conversation = db.fetch_one(
        "SELECT user_id FROM tavus_conversations WHERE conversation_id = ?",
        (conversation_id,),
    )
    if not conversation:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    raw_args = payload.get("arguments") or "{}"
    if isinstance(raw_args, str):
        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {}
    elif isinstance(raw_args, dict):
        args = raw_args
    else:
        args = {}
    instruction = str(args.get("instruction") or "").strip()
    if not instruction:
        raise HTTPException(status_code=400, detail="instruction is required.")
    task_id = new_id("task")
    now = now_iso()
    db.execute(
        """
        INSERT INTO tavus_tasks (
            id, user_id, conversation_id, tool_call_id, instruction, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
        """,
        (task_id, conversation["user_id"], conversation_id, tool_call_id, instruction[:2000], now, now),
    )
    return {"ok": "true", "taskId": task_id}


async def next_task(user_id: str, wait: float) -> dict[str, Any] | None:
    deadline = asyncio.get_running_loop().time() + max(0, min(wait, 25))
    while True:
        row = db.fetch_one(
            """
            SELECT * FROM tavus_tasks
            WHERE user_id = ? AND status = 'pending'
            ORDER BY created_at ASC LIMIT 1
            """,
            (user_id,),
        )
        if row:
            db.execute(
                "UPDATE tavus_tasks SET status = 'claimed', updated_at = ? WHERE id = ? AND status = 'pending'",
                (now_iso(), row["id"]),
            )
            claimed = db.fetch_one("SELECT * FROM tavus_tasks WHERE id = ?", (row["id"],))
            if claimed and claimed.get("status") == "claimed":
                return _public_task(claimed)
        if asyncio.get_running_loop().time() >= deadline:
            return None
        await asyncio.sleep(0.4)


def update_task(user_id: str, task_id: str, payload: dict[str, Any]) -> dict[str, Any]:
    row = db.fetch_one("SELECT * FROM tavus_tasks WHERE id = ? AND user_id = ?", (task_id, user_id))
    if not row:
        raise HTTPException(status_code=404, detail="Task not found.")
    status = str(payload.get("status") or row.get("status") or "claimed")
    if status not in {"claimed", "done", "failed"}:
        raise HTTPException(status_code=400, detail="Status must be claimed, done, or failed.")
    db.execute(
        """
        UPDATE tavus_tasks
        SET status = ?, hermes_session_id = ?, result_text = ?, updated_at = ?
        WHERE id = ?
        """,
        (
            status,
            str(payload.get("hermesSessionId") or row.get("hermes_session_id") or ""),
            str(payload.get("resultText") or row.get("result_text") or "")[:4000],
            now_iso(),
            task_id,
        ),
    )
    updated = db.fetch_one("SELECT * FROM tavus_tasks WHERE id = ?", (task_id,))
    return _public_task(updated or row)


def _public_task(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"],
        "conversationId": row.get("conversation_id") or "",
        "instruction": row.get("instruction") or "",
        "status": row.get("status") or "",
        "hermesSessionId": row.get("hermes_session_id") or "",
        "resultText": row.get("result_text") or "",
    }


@router.post("/api/tavus/tools/start-task")
async def start_task_route(request: Request) -> dict[str, str]:
    body = await request.body()
    signature = request.headers.get("x-tavus-signature", "")
    if not verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid Tavus signature.")
    return accept_task(body)


@router.get("/api/tavus/tasks/next")
async def next_task_route(request: Request, wait: int = 25) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    task = await next_task(str(user["id"]), float(wait))
    return {"task": task}


@router.post("/api/tavus/tasks/{task_id}")
async def update_task_route(task_id: str, request: Request) -> dict[str, Any]:
    user = await arequire_user_or_device(request)
    payload = await request.json()
    if not isinstance(payload, dict):
        raise HTTPException(status_code=400, detail="Task update must be an object.")
    return update_task(str(user["id"]), task_id, payload)
