"""HTTP client for the Hermes sidecar colocated with an agent worker.

Two ports are involved:

* the dashboard (``VERXIO_LOCAL_HERMES_URL``, :9119) for hot attach/detach of
  tenant profiles (``/internal/profiles/...``) and health;
* the API server (``VERXIO_LOCAL_HERMES_API_URL``, :8642) for running turns
  (``POST /v1/runs`` with ``profile`` + ``GET /v1/runs/{id}/events`` SSE).
"""

from __future__ import annotations

import json
import logging
import os
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass, field
from typing import Any

import httpx

logger = logging.getLogger("verxio.worker.hermes")


class HermesRunError(RuntimeError):
    pass


@dataclass
class RunResult:
    run_id: str
    status: str
    output: str = ""
    error: str | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    events: int = 0


def dashboard_url() -> str:
    return os.getenv("VERXIO_LOCAL_HERMES_URL", "http://127.0.0.1:9119").rstrip("/")


def api_url() -> str:
    return os.getenv("VERXIO_LOCAL_HERMES_API_URL", "http://127.0.0.1:8642").rstrip("/")


def _internal_headers() -> dict[str, str]:
    token = os.getenv("VERXIO_INTERNAL_TOKEN", "").strip()
    return {"X-Verxio-Internal-Token": token} if token else {}


def _api_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    key = os.getenv("HERMES_API_KEY", "").strip() or os.getenv("HERMES_API_SERVER_KEY", "").strip()
    if key:
        headers["Authorization"] = f"Bearer {key}"
    return headers


def _run_timeout_seconds() -> float:
    raw = os.getenv("VERXIO_WORKER_RUN_TIMEOUT_SECONDS", "1800").strip()
    try:
        return max(60.0, float(raw))
    except ValueError:
        return 1800.0


async def attach_profile(tenant: str, home: str) -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{dashboard_url()}/internal/profiles/{tenant}/attach",
            json={"home": home},
            headers=_internal_headers(),
        )
        response.raise_for_status()


async def detach_profile(tenant: str) -> None:
    async with httpx.AsyncClient(timeout=20) as client:
        response = await client.post(
            f"{dashboard_url()}/internal/profiles/{tenant}/detach",
            headers=_internal_headers(),
        )
        response.raise_for_status()


async def healthy() -> bool:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            dashboard = await client.get(f"{dashboard_url()}/api/healthz")
            api = await client.get(f"{api_url()}/health")
        return dashboard.status_code < 500 and api.status_code < 500
    except httpx.HTTPError:
        return False


async def start_run(
    *,
    tenant: str,
    text: str,
    session_id: str | None = None,
    instructions: str | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    model: str | None = None,
) -> str:
    body: dict[str, Any] = {"input": text, "profile": tenant}
    if session_id:
        body["session_id"] = session_id
    if instructions:
        body["instructions"] = instructions
    if conversation_history:
        body["conversation_history"] = conversation_history
    if model:
        body["model"] = model
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{api_url()}/v1/runs", json=body, headers=_api_headers())
    if response.status_code == 404:
        raise HermesRunError(f"Hermes does not know profile {tenant!r}")
    if response.status_code >= 400:
        raise HermesRunError(f"Hermes refused run ({response.status_code}): {response.text[:300]}")
    run_id = str(response.json().get("run_id") or "")
    if not run_id:
        raise HermesRunError("Hermes returned no run_id")
    return run_id


async def iter_run_events(run_id: str) -> AsyncIterator[dict[str, Any]]:
    """Yield structured lifecycle events from ``/v1/runs/{id}/events`` (SSE)."""
    timeout = httpx.Timeout(connect=10.0, read=_run_timeout_seconds(), write=30.0, pool=30.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        async with client.stream("GET", f"{api_url()}/v1/runs/{run_id}/events", headers=_api_headers()) as response:
            if response.status_code >= 400:
                body = await response.aread()
                raise HermesRunError(f"Hermes events stream failed ({response.status_code}): {body[:300]!r}")
            async for line in response.aiter_lines():
                if not line.startswith("data:"):
                    continue
                raw = line[5:].strip()
                if not raw:
                    continue
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                if isinstance(event, dict):
                    yield event


async def get_run(run_id: str) -> dict[str, Any]:
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(f"{api_url()}/v1/runs/{run_id}", headers=_api_headers())
        response.raise_for_status()
        return response.json()


async def stop_run(run_id: str) -> None:
    async with httpx.AsyncClient(timeout=15) as client:
        await client.post(f"{api_url()}/v1/runs/{run_id}/stop", headers=_api_headers())


async def run_turn(
    *,
    tenant: str,
    text: str,
    session_id: str | None = None,
    instructions: str | None = None,
    conversation_history: list[dict[str, str]] | None = None,
    model: str | None = None,
    on_event: Callable[[dict[str, Any]], None] | None = None,
) -> RunResult:
    """Start a run for ``tenant`` and follow it to completion."""
    run_id = await start_run(
        tenant=tenant,
        text=text,
        session_id=session_id,
        instructions=instructions,
        conversation_history=conversation_history,
        model=model,
    )
    result = RunResult(run_id=run_id, status="running")
    try:
        async for event in iter_run_events(run_id):
            result.events += 1
            if on_event is not None:
                try:
                    on_event(event)
                except Exception:
                    logger.debug("run event hook failed", exc_info=True)
            name = str(event.get("event") or "")
            if name == "run.completed":
                result.status = "completed"
                result.output = str(event.get("output") or "")
                usage = event.get("usage")
                result.usage = usage if isinstance(usage, dict) else {}
            elif name == "run.failed":
                result.status = "failed"
                result.error = str(event.get("error") or "agent run failed")
            elif name == "run.cancelled":
                result.status = "cancelled"
                result.error = "run cancelled"
    except httpx.HTTPError as exc:
        # Stream dropped; fall back to the pollable status so a finished run
        # is not reported as lost.
        logger.warning("Hermes SSE dropped for run %s: %s", run_id, exc)
    if result.status == "running":
        try:
            status = await get_run(run_id)
        except httpx.HTTPError as exc:
            raise HermesRunError(f"Run {run_id} state unknown after stream loss: {exc}") from exc
        result.status = str(status.get("status") or "failed")
        result.output = str(status.get("output") or "")
        result.error = status.get("error")
        usage = status.get("usage")
        result.usage = usage if isinstance(usage, dict) else {}
        if result.status in {"queued", "running", "waiting_for_approval"}:
            raise HermesRunError(f"Run {run_id} still {result.status} after stream loss")
    return result
