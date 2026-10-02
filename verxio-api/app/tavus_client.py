"""HTTP client for the Tavus API. The key never leaves this process."""

from __future__ import annotations

import os
from typing import Any

import httpx
from fastapi import HTTPException

TAVUS_BASE = "https://tavusapi.com"


class TavusError(Exception):
    def __init__(self, status: int, message: str) -> None:
        super().__init__(message)
        self.status = status
        self.message = message


def api_key() -> str:
    return os.getenv("TAVUS_API_KEY", "").strip()


def tool_secret() -> str:
    return os.getenv("TAVUS_TOOL_SECRET", "").strip()


def public_api_base() -> str:
    return (os.getenv("VERXIO_PUBLIC_API_URL") or "").strip().rstrip("/")


def configured() -> bool:
    return bool(api_key())


def request(method: str, path: str, *, json_body: Any = None, timeout: float = 30) -> Any:
    key = api_key()
    if not key:
        raise HTTPException(status_code=503, detail="Tavus is not configured.")
    url = path if path.startswith("http") else f"{TAVUS_BASE}{path}"
    try:
        response = httpx.request(
            method,
            url,
            headers={"x-api-key": key, "Content-Type": "application/json"},
            json=json_body,
            timeout=timeout,
        )
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail="Tavus could not be reached.") from exc
    if response.status_code == 204 or not response.content:
        return {}
    try:
        payload = response.json()
    except ValueError:
        payload = {"message": response.text}
    if response.status_code >= 400:
        message = ""
        if isinstance(payload, dict):
            message = str(payload.get("message") or payload.get("error") or payload.get("detail") or "")
        message = message or response.text or "Tavus request failed."
        lowered = message.lower()
        if response.status_code == 401:
            raise HTTPException(status_code=502, detail="Tavus rejected the API key.")
        if response.status_code == 429 or "maximum concurrent" in lowered:
            raise HTTPException(status_code=429, detail="Calls are busy, try again in a minute.")
        raise HTTPException(status_code=502, detail=message[:500] or "Tavus request failed.")
    return payload


def items(payload: Any, *keys: str) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [row for row in payload if isinstance(row, dict)]
    if not isinstance(payload, dict):
        return []
    for key in keys:
        value = payload.get(key)
        if isinstance(value, list):
            return [row for row in value if isinstance(row, dict)]
    data = payload.get("data")
    if isinstance(data, list):
        return [row for row in data if isinstance(row, dict)]
    return []
