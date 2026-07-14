from __future__ import annotations

import asyncio
import hashlib
import os
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

import httpx

from app.models import (
    RuntimeInstance,
    TranscriptionCatalogResponse,
    TranscriptionModelOption,
    TranscriptionProviderCatalogItem,
)


CACHE_TTL_SECONDS = 24 * 60 * 60
HTTP_TIMEOUT_SECONDS = 8.0

ProviderId = Literal["elevenlabs", "groq", "mistral", "openai", "xai"]


@dataclass(frozen=True)
class ProviderSpec:
    id: ProviderId
    label: str
    env_key: str
    key_envs: tuple[str, ...]
    base_url: str
    base_url_envs: tuple[str, ...]
    docs_url: str
    description: str
    fallback_models: tuple[str, ...]
    preferred_models: tuple[str, ...]


PROVIDER_SPECS: tuple[ProviderSpec, ...] = (
    ProviderSpec(
        id="groq",
        label="Groq",
        env_key="STT_GROQ_API_KEY",
        key_envs=("STT_GROQ_API_KEY", "GROQ_API_KEY"),
        base_url="https://api.groq.com/openai/v1",
        base_url_envs=("GROQ_BASE_URL",),
        docs_url="https://console.groq.com/keys",
        description="Fast, low-cost Whisper transcription. Create an API key in the Groq console.",
        fallback_models=("whisper-large-v3-turbo", "whisper-large-v3", "distil-whisper-large-v3-en"),
        preferred_models=("whisper-large-v3-turbo", "whisper-large-v3", "distil-whisper-large-v3-en"),
    ),
    ProviderSpec(
        id="openai",
        label="OpenAI",
        env_key="VOICE_TOOLS_OPENAI_KEY",
        key_envs=("VOICE_TOOLS_OPENAI_KEY", "OPENAI_API_KEY"),
        base_url="https://api.openai.com/v1",
        base_url_envs=("STT_OPENAI_BASE_URL",),
        docs_url="https://platform.openai.com/api-keys",
        description="High-quality hosted transcription. Create an API key in the OpenAI platform dashboard.",
        fallback_models=("gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"),
        preferred_models=("gpt-4o-mini-transcribe", "gpt-4o-transcribe", "whisper-1"),
    ),
    ProviderSpec(
        id="mistral",
        label="Mistral",
        env_key="STT_MISTRAL_API_KEY",
        key_envs=("STT_MISTRAL_API_KEY", "MISTRAL_API_KEY"),
        base_url="https://api.mistral.ai/v1",
        base_url_envs=("MISTRAL_BASE_URL",),
        docs_url="https://console.mistral.ai/api-keys",
        description="Voxtral transcription from Mistral. Create an API key in the Mistral console.",
        fallback_models=("voxtral-mini-latest", "voxtral-mini-2602"),
        preferred_models=("voxtral-mini-latest", "voxtral-mini-2602"),
    ),
    ProviderSpec(
        id="elevenlabs",
        label="ElevenLabs",
        env_key="STT_ELEVENLABS_API_KEY",
        key_envs=("STT_ELEVENLABS_API_KEY", "ELEVENLABS_API_KEY"),
        base_url="https://api.elevenlabs.io/v1",
        base_url_envs=("ELEVENLABS_STT_BASE_URL", "ELEVENLABS_BASE_URL"),
        docs_url="https://elevenlabs.io/app/settings/api-keys",
        description="Scribe transcription and premium voice features. Create an API key in ElevenLabs settings.",
        fallback_models=("scribe_v2", "scribe_v1"),
        preferred_models=("scribe_v2", "scribe_v1"),
    ),
    ProviderSpec(
        id="xai",
        label="xAI",
        env_key="STT_XAI_API_KEY",
        key_envs=("STT_XAI_API_KEY", "XAI_API_KEY"),
        base_url="https://api.x.ai/v1",
        base_url_envs=("XAI_STT_BASE_URL", "XAI_BASE_URL"),
        docs_url="https://console.x.ai/",
        description="Optional Grok speech-to-text provider. Create an API key in the xAI console.",
        fallback_models=("grok-stt",),
        preferred_models=("grok-stt",),
    ),
)


_CATALOG_CACHE: dict[tuple[str, str], tuple[float, list[str]]] = {}


def _read_dotenv(path: Path) -> dict[str, str]:
    if not path.is_file():
        return {}

    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[len("export ") :].strip()
        if "=" not in line:
            continue

        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip()
        if not key:
            continue
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key] = value
    return values


def _runtime_env(runtime: RuntimeInstance) -> dict[str, str]:
    values = _read_dotenv(Path(runtime.hermes_home_path) / ".env")
    for spec in PROVIDER_SPECS:
        for name in (*spec.key_envs, *spec.base_url_envs):
            if values.get(name):
                continue
            env_value = os.getenv(name, "").strip()
            if env_value:
                values[name] = env_value
    return values


def _first_env_value(values: dict[str, str], names: tuple[str, ...]) -> str:
    for name in names:
        value = values.get(name, "").strip()
        if value:
            return value
    return ""


def _cache_key(spec: ProviderSpec, api_key: str, base_url: str) -> tuple[str, str]:
    digest = hashlib.sha256(f"{api_key}\0{base_url}".encode("utf-8")).hexdigest()
    return spec.id, digest


def _fallback_models(spec: ProviderSpec) -> list[TranscriptionModelOption]:
    return [TranscriptionModelOption(id=model, source="fallback") for model in spec.fallback_models]


def _looks_like_transcription_model(provider: ProviderId, model_id: str, payload: dict[str, Any] | None = None) -> bool:
    normalized = model_id.lower()
    text = normalized
    if payload:
        text = " ".join(
            [
                normalized,
                str(payload.get("name") or "").lower(),
                str(payload.get("display_name") or "").lower(),
                str(payload.get("description") or "").lower(),
                str(payload.get("owned_by") or "").lower(),
            ]
        )

    if provider == "openai":
        return normalized == "whisper-1" or "transcribe" in normalized or "transcription" in text
    if provider == "groq":
        return "whisper" in normalized
    if provider == "mistral":
        return "voxtral" in normalized or "transcribe" in text
    if provider == "elevenlabs":
        return normalized.startswith("scribe") or "scribe" in text or "speech-to-text" in text
    if provider == "xai":
        return "stt" in normalized or "speech" in text or "transcrib" in text
    return False


def _ordered_model_ids(ids: list[str], preferred: tuple[str, ...]) -> list[str]:
    seen: set[str] = set()
    available = [model for model in ids if model and not (model in seen or seen.add(model))]
    available_set = set(available)
    ordered = [model for model in preferred if model in available_set]
    ordered.extend(sorted(model for model in available if model not in set(ordered)))
    return ordered


def _extract_model_ids(provider: ProviderId, payload: Any) -> list[str]:
    if isinstance(payload, dict):
        raw_models = payload.get("data")
        if raw_models is None:
            raw_models = payload.get("models")
    else:
        raw_models = payload

    if not isinstance(raw_models, list):
        return []

    ids: list[str] = []
    for item in raw_models:
        model_payload = item if isinstance(item, dict) else None
        model_id = ""
        if isinstance(item, str):
            model_id = item
        elif model_payload:
            model_id = str(
                model_payload.get("id")
                or model_payload.get("model_id")
                or model_payload.get("modelId")
                or model_payload.get("name")
                or ""
            ).strip()

        if model_id and _looks_like_transcription_model(provider, model_id, model_payload):
            ids.append(model_id)

    return ids


async def _fetch_provider_models(
    client: httpx.AsyncClient,
    spec: ProviderSpec,
    api_key: str,
    env: dict[str, str],
) -> list[str]:
    base_url = _first_env_value(env, spec.base_url_envs) or spec.base_url
    base_url = base_url.rstrip("/")
    endpoint = f"{base_url}/models"
    headers = {"Authorization": f"Bearer {api_key}"}
    if spec.id == "elevenlabs":
        headers = {"xi-api-key": api_key}

    response = await client.get(endpoint, headers=headers)
    response.raise_for_status()
    return _ordered_model_ids(_extract_model_ids(spec.id, response.json()), spec.preferred_models)


def _provider_error(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        if status in {401, 403}:
            return "API key was rejected while refreshing the model list."
        if status == 404:
            return "Provider model catalog endpoint was not found."
        return f"Provider model catalog returned HTTP {status}."
    if isinstance(exc, httpx.TimeoutException):
        return "Provider model catalog timed out."
    if isinstance(exc, httpx.TransportError):
        return "Provider model catalog could not be reached."
    return "Provider model catalog could not be refreshed."


async def _catalog_item_for_provider(
    client: httpx.AsyncClient,
    spec: ProviderSpec,
    env: dict[str, str],
    *,
    refresh: bool,
) -> TranscriptionProviderCatalogItem:
    api_key = _first_env_value(env, spec.key_envs)
    configured = bool(api_key)
    base_url = _first_env_value(env, spec.base_url_envs) or spec.base_url
    recommended = spec.preferred_models[0]
    fetched_at: str | None = None

    if not configured:
        return TranscriptionProviderCatalogItem(
            id=spec.id,
            label=spec.label,
            envKey=spec.env_key,
            docsUrl=spec.docs_url,
            description=spec.description,
            configured=False,
            recommendedModel=recommended,
            models=_fallback_models(spec),
            source="fallback",
        )

    key = _cache_key(spec, api_key, base_url)
    cached = _CATALOG_CACHE.get(key)
    now = time.time()
    if cached and not refresh and now - cached[0] < CACHE_TTL_SECONDS:
        fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(cached[0]))
        models = cached[1]
        return TranscriptionProviderCatalogItem(
            id=spec.id,
            label=spec.label,
            envKey=spec.env_key,
            docsUrl=spec.docs_url,
            description=spec.description,
            configured=True,
            recommendedModel=models[0] if models else recommended,
            models=[TranscriptionModelOption(id=model, source="provider") for model in models],
            source="provider",
            fetchedAt=fetched_at,
        )

    try:
        models = await _fetch_provider_models(client, spec, api_key, env)
    except Exception as exc:  # noqa: BLE001 - provider catalogs are best effort
        return TranscriptionProviderCatalogItem(
            id=spec.id,
            label=spec.label,
            envKey=spec.env_key,
            docsUrl=spec.docs_url,
            description=spec.description,
            configured=True,
            recommendedModel=recommended,
            models=_fallback_models(spec),
            source="fallback",
            error=_provider_error(exc),
        )

    if not models:
        return TranscriptionProviderCatalogItem(
            id=spec.id,
            label=spec.label,
            envKey=spec.env_key,
            docsUrl=spec.docs_url,
            description=spec.description,
            configured=True,
            recommendedModel=recommended,
            models=_fallback_models(spec),
            source="fallback",
            error="Provider did not return transcription-capable models.",
        )

    fetched_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now))
    _CATALOG_CACHE[key] = (now, models)
    return TranscriptionProviderCatalogItem(
        id=spec.id,
        label=spec.label,
        envKey=spec.env_key,
        docsUrl=spec.docs_url,
        description=spec.description,
        configured=True,
        recommendedModel=models[0],
        models=[TranscriptionModelOption(id=model, source="provider") for model in models],
        source="provider",
        fetchedAt=fetched_at,
    )


async def list_transcription_catalog(
    runtime: RuntimeInstance,
    *,
    refresh: bool = False,
) -> TranscriptionCatalogResponse:
    env = _runtime_env(runtime)
    timeout = httpx.Timeout(HTTP_TIMEOUT_SECONDS)
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        providers = await asyncio.gather(
            *[_catalog_item_for_provider(client, spec, env, refresh=refresh) for spec in PROVIDER_SPECS]
        )
    return TranscriptionCatalogResponse(providers=list(providers), cacheTtlSeconds=CACHE_TTL_SECONDS)
