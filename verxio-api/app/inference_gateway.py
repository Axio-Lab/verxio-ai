"""OpenAI-compatible inference gateway for Verxio Desktop and pool workers.

Desktop Hermes and cloud workers call ``/api/inference/v1`` with a device or
session credential. Hosted DashScope / Gemini keys stay on the control plane;
the gateway forwards the request and meters tokens into ``usage_events``.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

import httpx
from fastapi import HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

from app.inference import (
    DEFAULT_MODEL_ID,
    MODEL_CATALOG,
    _available_model_ids,
    _hosted_secret,
    _upstream_model_id,
    assert_inference_budget,
    record_inference_usage,
    resolve_hosted_model,
)
from app.models import GatewayModel, GatewayModelList

logger = logging.getLogger(__name__)

DEFAULT_QWEN_BASE = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
DEFAULT_GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/openai"


def _provider_base_url(provider_slug: str) -> str:
    if provider_slug == "gemini":
        return os.getenv("VERXIO_GEMINI_BASE_URL", DEFAULT_GEMINI_BASE).rstrip("/")
    return os.getenv("VERXIO_QWEN_BASE_URL", DEFAULT_QWEN_BASE).rstrip("/")


def list_gateway_models() -> GatewayModelList:
    return GatewayModelList(
        data=[
            GatewayModel(
                id=model.id,
                owned_by=model.provider_slug,
                verxioModelId=model.id,
                providerSlug=model.provider_slug,
                hostedAvailable=bool(_hosted_secret(model)[1]),
            )
            for model in MODEL_CATALOG
        ]
    )


def _usage_tokens(usage: Any) -> tuple[int, int]:
    if not isinstance(usage, dict):
        return 0, 0
    prompt = int(usage.get("prompt_tokens") or usage.get("input_tokens") or 0)
    completion = int(usage.get("completion_tokens") or usage.get("output_tokens") or 0)
    return max(0, prompt), max(0, completion)


def _rewrite_payload(body: dict[str, Any]) -> tuple[dict[str, Any], Any, str, str]:
    requested = str(body.get("model") or DEFAULT_MODEL_ID)
    model = resolve_hosted_model(requested)
    secret_name, secret = _hosted_secret(model)
    if not secret:
        raise HTTPException(status_code=503, detail=f"{model.display_name} is not configured.")
    upstream = requested if requested in _available_model_ids(model) and requested != model.id else _upstream_model_id(model)
    payload = dict(body)
    payload["model"] = upstream
    return payload, model, secret, upstream


def _meter(user: dict[str, Any], model: Any, upstream: str, input_tokens: int, output_tokens: int, body: dict[str, Any]) -> None:
    try:
        record_inference_usage(
            str(user["id"]),
            verxio_model_id=model.id,
            provider_slug=model.provider_slug,
            upstream_model_id=upstream,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            session_id=str(body.get("user") or "") or None,
        )
    except Exception:
        logger.exception("Failed to record inference usage for user %s", user.get("id"))


async def proxy_chat_completions(user: dict[str, Any], request: Request) -> JSONResponse | StreamingResponse:
    assert_inference_budget(str(user["id"]))
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Request body must be JSON.") from exc
    if not isinstance(body, dict):
        raise HTTPException(status_code=400, detail="Request body must be a JSON object.")

    payload, model, secret, upstream = _rewrite_payload(body)
    url = f"{_provider_base_url(model.provider_slug)}/chat/completions"
    headers = {
        "Authorization": f"Bearer {secret}",
        "Content-Type": "application/json",
    }
    stream = bool(payload.get("stream"))
    timeout = httpx.Timeout(300.0, connect=15.0)

    if not stream:
        async with httpx.AsyncClient(timeout=timeout) as client:
            try:
                response = await client.post(url, headers=headers, json=payload)
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail=f"Upstream inference failed: {exc}") from exc
        if response.status_code >= 400:
            raise HTTPException(status_code=response.status_code, detail=response.text[:2000])
        data = response.json()
        prompt, completion = _usage_tokens(data.get("usage"))
        _meter(user, model, upstream, prompt, completion, payload)
        return JSONResponse(data)

    async def _stream() -> Any:
        usage: dict[str, Any] = {}
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code >= 400:
                        error_text = (await response.aread()).decode("utf-8", errors="replace")
                        yield f"data: {json.dumps({'error': error_text[:1000]})}\n\n".encode("utf-8")
                        return
                    async for chunk in response.aiter_bytes():
                        text = chunk.decode("utf-8", errors="replace")
                        for line in text.splitlines():
                            if not line.startswith("data:"):
                                continue
                            data = line[5:].strip()
                            if not data or data == "[DONE]":
                                continue
                            try:
                                parsed = json.loads(data)
                            except json.JSONDecodeError:
                                continue
                            if isinstance(parsed, dict) and isinstance(parsed.get("usage"), dict):
                                usage = parsed["usage"]
                        yield chunk
        finally:
            prompt, completion = _usage_tokens(usage)
            _meter(user, model, upstream, prompt, completion, payload)

    return StreamingResponse(_stream(), media_type="text/event-stream")
