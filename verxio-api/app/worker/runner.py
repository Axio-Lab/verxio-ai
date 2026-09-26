"""Agent worker: runs tenant turns on the colocated Hermes sidecar.

Consumes:

* ``verxio:turns`` (shared) and ``verxio:turns:w:{worker}`` (sticky) — turns
  from web, channels, cron and webhooks. A turn for a tenant leased by another
  live worker is handed off to that worker's stream.
* ``verxio:attach`` — warm-attach requests from the API's pool manager.
* ``verxio:webhooks`` — control-plane webhook ingress (workflow, Composio,
  Telegram/Slack updates, messaging hooks) that becomes turns or workflow runs.

Every turn is executed for real through ``POST /v1/runs`` with the tenant
profile, streamed over SSE, published on ``verxio:turns:{ws}:{agent}`` for
observers, then the tenant's workspace is indexed into object storage and the
home is scheduled for sync.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import signal
from contextlib import suppress
from typing import Any

from app import db
from app.infra.redis import (
    GROUP_WORKERS,
    STREAM_ATTACH,
    STREAM_TURNS,
    STREAM_WEBHOOKS,
    lookup_tenant_holder,
    publish,
    read_group,
    worker_id,
    worker_stream,
    xack,
)
from app.jobs import enqueue_deliver, enqueue_turn, mark_job, requeue_turn_to
from app.runtime_orch.lifecycle import touch_runtime_activity
from app.worker import hermes_client
from app.worker.tenants import AttachRejected, AttachedTenant, TenantRegistry

logger = logging.getLogger("verxio.worker")

REGISTRY = TenantRegistry()


def _payload(fields: dict[str, str]) -> dict[str, Any]:
    raw = fields.get("payload") or "{}"
    if isinstance(raw, dict):
        return raw
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _events_channel(workspace_id: str, agent_id: str) -> str:
    return f"verxio:turns:{workspace_id}:{agent_id}"


def _max_concurrent_runs() -> int:
    raw = os.getenv("VERXIO_WORKER_MAX_CONCURRENT_RUNS", "8").strip()
    try:
        return max(1, int(raw))
    except ValueError:
        return 8


_RUN_SLOTS: asyncio.Semaphore | None = None


def _slots() -> asyncio.Semaphore:
    global _RUN_SLOTS
    if _RUN_SLOTS is None:
        _RUN_SLOTS = asyncio.Semaphore(_max_concurrent_runs())
    return _RUN_SLOTS


# --------------------------------------------------------------------- attach
async def handle_attach(fields: dict[str, str]) -> None:
    workspace_id = fields.get("workspace_id", "")
    agent_id = fields.get("agent_id", "")
    if not workspace_id or not agent_id:
        return
    try:
        await REGISTRY.ensure_attached(workspace_id, agent_id)
    except AttachRejected as exc:
        # Held elsewhere or we are full: another worker in the group will (or
        # already did) take it. Nothing to do here.
        logger.info("Attach skipped %s:%s: %s", workspace_id, agent_id, exc)


# ----------------------------------------------------------------------- turn
async def handle_turn(fields: dict[str, str]) -> None:
    workspace_id = fields.get("workspace_id", "")
    agent_id = fields.get("agent_id", "")
    job_id = fields.get("job_id", "")
    payload = _payload(fields)
    if not workspace_id or not agent_id:
        if job_id:
            mark_job(job_id, status="failed", error="turn without tenant")
        return

    try:
        tenant = await REGISTRY.ensure_attached(workspace_id, agent_id)
    except AttachRejected as exc:
        if exc.holder and exc.holder != REGISTRY.worker:
            holder = lookup_tenant_holder(workspace_id, agent_id)
            if holder:
                requeue_turn_to(worker_stream(str(holder["worker"])), fields)
                logger.info("Handed off turn job=%s to holder %s", job_id, holder["worker"])
                return
        # Orphaned lease or capacity: give the shared group another chance.
        if fields.get("_hops", "0") in {"0", ""}:
            requeue_turn_to(STREAM_TURNS, {**fields, "_hops": "1"})
            return
        if job_id:
            mark_job(job_id, status="failed", error=str(exc))
        logger.warning("Dropping turn job=%s: %s", job_id, exc)
        return

    async with _slots():
        await _execute_turn(tenant, job_id, payload)


async def _execute_turn(tenant: AttachedTenant, job_id: str, payload: dict[str, Any]) -> None:
    runtime = tenant.runtime
    source = str(payload.get("source") or "web")
    channel = _events_channel(runtime.workspace_id, runtime.agent_id)
    if source.startswith("workflow:") and payload.get("run_id"):
        await _execute_workflow_turn(tenant, job_id, payload, source)
        return
    text = str(payload.get("text") or payload.get("prompt") or payload.get("input") or "").strip()
    if not text:
        if job_id:
            mark_job(job_id, status="failed", error="empty turn")
        return

    session_id = _session_id_for(payload, source)
    instructions = payload.get("instructions")
    tenant.active_runs += 1
    REGISTRY.mark_activity(tenant)
    if job_id:
        mark_job(job_id, status="running")
    publish(channel, {"status": "started", "source": source, "job_id": job_id, "worker": REGISTRY.worker})

    def _on_event(event: dict[str, Any]) -> None:
        name = str(event.get("event") or "")
        if name in {"message.delta"}:
            return  # too chatty for the bus; observers stream from Hermes directly
        publish(channel, {"status": "event", "job_id": job_id, "event": event})

    result = None
    error: str | None = None
    try:
        result = await hermes_client.run_turn(
            tenant=tenant.name,
            text=text,
            session_id=session_id,
            instructions=str(instructions) if instructions else None,
            model=str(payload.get("model")) if payload.get("model") else None,
            on_event=_on_event,
        )
        if result.status != "completed":
            error = result.error or result.status
    except hermes_client.HermesRunError as exc:
        error = str(exc)
    except Exception as exc:  # pragma: no cover - defensive
        logger.exception("Turn crashed job=%s", job_id)
        error = str(exc)
    finally:
        tenant.active_runs = max(0, tenant.active_runs - 1)
        REGISTRY.mark_activity(tenant)

    output = result.output if result else ""
    if job_id:
        mark_job(job_id, status="completed" if error is None else "failed", error=error)
    publish(
        channel,
        {
            "status": "completed" if error is None else "failed",
            "job_id": job_id,
            "source": source,
            "run_id": result.run_id if result else None,
            "error": error,
            "usage": result.usage if result else {},
        },
    )

    await _post_turn(tenant, job_id, payload, source, output, error)


def _local_bindings(tenant: AttachedTenant):
    """Route ``run_agent_via_dashboard`` / ``send_message_via_dashboard`` to
    this worker's Hermes sidecar and the tenant delivery queue."""
    from app.runtime_dashboard import local_runtime_bindings

    runtime = tenant.runtime

    async def _oneshot(_workspace, _profile, user_input, instructions, images) -> str:
        text = user_input
        if images:
            text = f"{user_input}\n\nAttached images:\n" + "\n".join(str(ref) for ref in images)
        result = await hermes_client.run_turn(
            tenant=tenant.name,
            text=text,
            session_id=None,  # one-shot: fresh context per workflow step
            instructions=str(instructions) if instructions else None,
        )
        if result.status != "completed":
            raise hermes_client.HermesRunError(result.error or result.status)
        return result.output

    async def _send(_workspace, _profile, platform, connection_id, destination, message) -> dict[str, object]:
        job_id = await asyncio.to_thread(
            enqueue_deliver,
            workspace_id=runtime.workspace_id,
            agent_id=runtime.agent_id,
            tenant_id=runtime.tenant_id,
            platform=str(platform),
            payload={
                "chat_id": destination,
                "connection_id": connection_id or "default",
                "text": message,
            },
        )
        return {"ok": True, "queued": True, "job_id": job_id, "platform": platform, "destination": destination}

    return local_runtime_bindings(oneshot=_oneshot, sender=_send)


async def _execute_workflow_turn(tenant: AttachedTenant, job_id: str, payload: dict[str, Any], source: str) -> None:
    """Execute a queued workflow run (created by the API) on this worker."""
    from app.control_plane import agent_from_row, workspace_from_row
    from app.workflow_agents import execute_workflow_run, get_agent, load_workflow_run

    runtime = tenant.runtime
    channel = _events_channel(runtime.workspace_id, runtime.agent_id)
    run_id = str(payload.get("run_id") or "")
    trigger_type = source.split(":", 1)[1] or "manual"

    def _load():
        run = load_workflow_run(run_id)
        workspace_row = db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (runtime.workspace_id,))
        agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (runtime.agent_id,))
        if not run or not workspace_row or not agent_row:
            return None
        workspace = workspace_from_row(workspace_row)
        profile = agent_from_row(agent_row)
        agent = get_agent(workspace, profile, str(payload.get("workflow_agent_id") or run.workflow_agent_id))
        return run, workspace, profile, agent

    loaded = await asyncio.to_thread(_load)
    if loaded is None:
        if job_id:
            mark_job(job_id, status="failed", error=f"workflow run {run_id} not found")
        return
    run, workspace, profile, agent = loaded
    if run.status in {"completed", "failed"}:
        # Redelivered job for a finished run — nothing to do.
        if job_id:
            mark_job(job_id, status="completed")
        return

    tenant.active_runs += 1
    REGISTRY.mark_activity(tenant)
    if job_id:
        mark_job(job_id, status="running")
    publish(channel, {"status": "started", "source": source, "job_id": job_id, "run_id": run_id, "worker": REGISTRY.worker})
    error: str | None = None
    output = ""
    try:
        with _local_bindings(tenant):
            finished = await execute_workflow_run(
                workspace,
                profile,
                agent,
                run,
                run.input if isinstance(run.input, dict) else dict(payload.get("input") or {}),
                trigger_type=trigger_type,
                trigger_id=str(payload.get("trigger_id") or "") or None,
            )
        output = finished.output_text or ""
        if finished.status != "completed":
            error = finished.error or finished.status
    except Exception as exc:
        logger.exception("Workflow run crashed run=%s job=%s", run_id, job_id)
        error = str(exc)
    finally:
        tenant.active_runs = max(0, tenant.active_runs - 1)
        REGISTRY.mark_activity(tenant)

    if job_id:
        mark_job(job_id, status="completed" if error is None else "failed", error=error)
    publish(
        channel,
        {"status": "completed" if error is None else "failed", "job_id": job_id, "source": source, "run_id": run_id, "error": error},
    )
    await _post_turn(tenant, job_id, payload, source, output, error)


def _session_id_for(payload: dict[str, Any], source: str) -> str | None:
    explicit = str(payload.get("session_id") or "").strip()
    if explicit:
        return explicit
    if source == "channel":
        platform = str(payload.get("platform") or "channel")
        chat_id = str(payload.get("chat_id") or payload.get("user_id") or "")
        return f"{platform}:{chat_id}" if chat_id else None
    if source == "cron":
        cron_id = str(payload.get("cron_job_id") or "")
        return f"cron:{cron_id}" if cron_id else None
    return None


async def _post_turn(
    tenant: AttachedTenant,
    job_id: str,
    payload: dict[str, Any],
    source: str,
    output: str,
    error: str | None,
) -> None:
    runtime = tenant.runtime
    # Outbound delivery for channel-sourced turns goes back through the gateway
    # that owns the tenant's connection.
    if source == "channel" and payload.get("chat_id"):
        text = output if error is None else f"Sorry — I could not complete that request. ({error})"
        if text.strip():
            await asyncio.to_thread(
                enqueue_deliver,
                workspace_id=runtime.workspace_id,
                agent_id=runtime.agent_id,
                tenant_id=runtime.tenant_id,
                platform=str(payload.get("platform") or ""),
                payload={
                    "chat_id": payload.get("chat_id"),
                    "reply_to": payload.get("message_id"),
                    "connection_id": payload.get("connection_id") or "default",
                    "text": text,
                    "turn_job_id": job_id,
                },
            )
    if source == "cron" and payload.get("cron_job_id"):
        from app.cron_store import record_cron_result

        await asyncio.to_thread(
            record_cron_result,
            str(payload["cron_job_id"]),
            status="completed" if error is None else "failed",
            output=output,
            error=error,
            home=tenant.home,
        )
        deliver = payload.get("deliver") if isinstance(payload.get("deliver"), dict) else None
        if deliver and deliver.get("platform") and deliver.get("chat_id") and output.strip() and error is None:
            await asyncio.to_thread(
                enqueue_deliver,
                workspace_id=runtime.workspace_id,
                agent_id=runtime.agent_id,
                tenant_id=runtime.tenant_id,
                platform=str(deliver["platform"]),
                payload={"chat_id": deliver["chat_id"], "text": output, "turn_job_id": job_id},
            )

    try:
        await asyncio.to_thread(touch_runtime_activity, runtime)
    except Exception:
        logger.debug("touch_runtime_activity failed", exc_info=True)


# -------------------------------------------------------------------- webhooks
async def handle_webhook(fields: dict[str, str]) -> None:
    kind = fields.get("kind", "")
    job_id = fields.get("job_id", "")
    payload = _payload(fields)
    workspace_id = fields.get("workspace_id", "")
    if job_id:
        mark_job(job_id, status="running")
    try:
        if kind == "workflow_webhook":
            from app.workflow_agents import run_webhook_trigger

            await run_webhook_trigger(
                str(payload.get("trigger_id") or ""),
                str(payload.get("secret") or ""),
                payload.get("body") if isinstance(payload.get("body"), dict) else {},
            )
        elif kind == "composio_webhook":
            from app.composio_catalog import complete_composio_webhook, release_composio_webhook
            from app.workflow_agents import run_composio_trigger_event

            webhook_id = str(payload.get("webhook_id") or "")
            try:
                await run_composio_trigger_event(payload.get("event") if isinstance(payload.get("event"), dict) else {})
            except Exception:
                if webhook_id:
                    release_composio_webhook(webhook_id)
                raise
            if webhook_id:
                complete_composio_webhook(webhook_id)
        elif kind in {"telegram", "slack"}:
            await _channel_update_to_turn(kind, workspace_id, payload)
        elif kind == "messaging_hook":
            from app.messaging_webhooks import forward_queued_hook

            await forward_queued_hook(workspace_id, payload)
        else:
            raise ValueError(f"Unknown webhook kind {kind!r}")
    except Exception as exc:
        logger.exception("Webhook job failed kind=%s job=%s", kind, job_id)
        if job_id:
            mark_job(job_id, status="failed", error=str(exc)[:500])
        return
    if job_id:
        mark_job(job_id, status="completed")


def _default_agent_for_workspace(workspace_id: str) -> dict[str, Any] | None:
    return db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? ORDER BY last_activity_at DESC LIMIT 1",
        (workspace_id,),
    )


async def _channel_update_to_turn(platform: str, workspace_id: str, update: dict[str, Any]) -> None:
    """Turn a raw Telegram/Slack webhook body into a tenant turn."""
    text = ""
    chat_id = ""
    user_id = ""
    message_id = ""
    if platform == "telegram":
        message = update.get("message") or update.get("edited_message") or {}
        if not isinstance(message, dict):
            return
        text = str(message.get("text") or message.get("caption") or "")
        chat = message.get("chat") if isinstance(message.get("chat"), dict) else {}
        chat_id = str(chat.get("id") or "")
        sender = message.get("from") if isinstance(message.get("from"), dict) else {}
        user_id = str(sender.get("id") or "")
        message_id = str(message.get("message_id") or "")
    elif platform == "slack":
        event = update.get("event") if isinstance(update.get("event"), dict) else {}
        if event.get("bot_id") or event.get("subtype") in {"bot_message", "message_changed", "message_deleted"}:
            return
        if event.get("type") not in {"message", "app_mention"}:
            return
        text = str(event.get("text") or "")
        chat_id = str(event.get("channel") or "")
        user_id = str(event.get("user") or "")
        message_id = str(event.get("ts") or "")
    if not text.strip() or not chat_id:
        return
    row = await asyncio.to_thread(_default_agent_for_workspace, workspace_id)
    if not row:
        raise ValueError(f"No runtime for workspace {workspace_id}")
    await asyncio.to_thread(
        enqueue_turn,
        tenant_id=str(row["tenant_id"]),
        workspace_id=workspace_id,
        agent_id=str(row["agent_id"]),
        source="channel",
        payload={
            "platform": platform,
            "text": text,
            "chat_id": chat_id,
            "user_id": user_id,
            "message_id": message_id,
        },
    )


# ------------------------------------------------------------------- consumers
async def _consume(stream: str, handler, *, concurrent: bool = False) -> None:
    consumer = REGISTRY.worker
    inflight: set[asyncio.Task[None]] = set()

    async def _run(message_id: str, fields: dict[str, str]) -> None:
        try:
            await handler(fields)
        except Exception:
            logger.exception("Worker failed stream=%s id=%s", stream, message_id)
        finally:
            await asyncio.to_thread(xack, stream, GROUP_WORKERS, message_id)

    while True:
        try:
            messages = await asyncio.to_thread(read_group, stream, GROUP_WORKERS, consumer, count=4, block_ms=2000)
        except Exception:
            logger.exception("Stream read failed stream=%s", stream)
            await asyncio.sleep(1.0)
            continue
        for message_id, fields in messages:
            if concurrent:
                task = asyncio.create_task(_run(message_id, fields))
                inflight.add(task)
                task.add_done_callback(inflight.discard)
            else:
                await _run(message_id, fields)


async def _wait_for_hermes() -> None:
    delay = 1.0
    while not await hermes_client.healthy():
        logger.info("Waiting for Hermes sidecar at %s / %s", hermes_client.dashboard_url(), hermes_client.api_url())
        await asyncio.sleep(delay)
        delay = min(delay * 1.5, 10.0)


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
    await _wait_for_hermes()
    REGISTRY.register()
    tasks = [
        asyncio.create_task(_consume(STREAM_TURNS, handle_turn, concurrent=True), name="turns"),
        asyncio.create_task(_consume(worker_stream(REGISTRY.worker), handle_turn, concurrent=True), name="turns-sticky"),
        asyncio.create_task(_consume(STREAM_ATTACH, handle_attach), name="attach"),
        asyncio.create_task(_consume(STREAM_WEBHOOKS, handle_webhook, concurrent=True), name="webhooks"),
        asyncio.create_task(REGISTRY.maintenance_loop(stop), name="maintenance"),
        asyncio.create_task(REGISTRY.control_loop(stop), name="control"),
    ]
    await stop.wait()
    logger.info("Agent worker draining id=%s", REGISTRY.worker)
    for task in tasks:
        task.cancel()
        with suppress(asyncio.CancelledError):
            await task
    await REGISTRY.detach_all(reason="shutdown")


def main() -> None:
    asyncio.run(run_worker())


if __name__ == "__main__":
    main()
