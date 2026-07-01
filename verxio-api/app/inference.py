from __future__ import annotations

import hashlib
import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import yaml

from app import db
from app.control_plane import ensure_runtime_directories, now_iso
from app.models import (
    InferenceCatalogResponse,
    InferenceModelCapability,
    InferenceModelCatalogItem,
    InferenceModelPricing,
    InferenceRuntimeBridgeStatus,
    InferenceSettings,
    InferenceSettingsUpdate,
    InferenceUsageResponse,
    InferenceUsageSummary,
    RuntimeInstance,
)


DEFAULT_MODEL_ID = "verxio-qwen"
DEFAULT_QWEN_UPSTREAM_MODEL = "qwen3.6-plus"
HOSTED_QWEN_MODEL_ENV = "VERXIO_HOSTED_QWEN_MODEL"
CATALOG_VERSION = "2026-07-01"
BRIDGE_STATE_FILE = "inference-runtime-bridge.json"

# Verxio GPT hosted injected these into runtime containers. Strip them when Qwen
# hosted is active so the model picker does not keep showing OpenAI API.
LEGACY_HOSTED_RUNTIME_ENV_VARS = ("OPENAI_API_KEY",)
LEGACY_HOSTED_PROVIDER_SLUGS = ("openai-api",)


@dataclass(frozen=True)
class HostedModelDefinition:
    id: str
    display_name: str
    description: str
    provider_slug: str
    upstream_model_default: str
    upstream_model_env: str | None
    hosted_secret_env: tuple[str, ...]
    runtime_env_var: str
    byok_env_vars: tuple[str, ...]
    tier: str
    input_per_million: float
    output_per_million: float
    capabilities: tuple[tuple[str, str], ...]


def _env_override(name: str, default: str) -> str:
    return os.getenv(name, default).strip() or default


def _upstream_model_id(model: HostedModelDefinition) -> str:
    if model.upstream_model_env:
        return _env_override(model.upstream_model_env, model.upstream_model_default)
    return model.upstream_model_default


MODEL_CATALOG: tuple[HostedModelDefinition, ...] = (
    HostedModelDefinition(
        id="verxio-qwen",
        display_name="Verxio Qwen",
        description="Hosted Qwen Cloud through Alibaba DashScope for fast coding and long-context agent work.",
        provider_slug="alibaba",
        upstream_model_default=DEFAULT_QWEN_UPSTREAM_MODEL,
        upstream_model_env=HOSTED_QWEN_MODEL_ENV,
        hosted_secret_env=("VERXIO_HOSTED_QWEN_API_KEY", "VERXIO_DASHSCOPE_API_KEY"),
        runtime_env_var="DASHSCOPE_API_KEY",
        byok_env_vars=("DASHSCOPE_API_KEY",),
        tier="balanced",
        input_per_million=0.8,
        output_per_million=2.4,
        capabilities=(("coding", "Coding"), ("long_context", "Long context"), ("tools", "Tool use")),
    ),
)


def _model_by_id(model_id: str | None) -> HostedModelDefinition:
    requested = (model_id or DEFAULT_MODEL_ID).strip()
    for model in MODEL_CATALOG:
        if model.id == requested:
            return model
    return MODEL_CATALOG[0]


def _hosted_secret(model: HostedModelDefinition) -> tuple[str | None, str | None]:
    for env_name in model.hosted_secret_env:
        value = os.getenv(env_name, "").strip()
        if value:
            return env_name, value
    return None, None


def _catalog_item(model: HostedModelDefinition) -> InferenceModelCatalogItem:
    _secret_name, secret_value = _hosted_secret(model)
    return InferenceModelCatalogItem(
        id=model.id,
        displayName=model.display_name,
        description=model.description,
        providerSlug=model.provider_slug,
        upstreamModelId=_upstream_model_id(model),
        requiredEnvVars=list(model.byok_env_vars),
        hostedAvailable=bool(secret_value),
        byokAvailable=True,
        tier=model.tier,
        capabilities=[InferenceModelCapability(key=key, label=label) for key, label in model.capabilities],
        pricing=InferenceModelPricing(
            inputPerMillion=model.input_per_million,
            outputPerMillion=model.output_per_million,
        ),
        default=model.id == DEFAULT_MODEL_ID,
    )


def list_inference_catalog() -> InferenceCatalogResponse:
    return InferenceCatalogResponse(
        models=[_catalog_item(model) for model in MODEL_CATALOG],
        defaultModelId=DEFAULT_MODEL_ID,
    )


def ensure_inference_settings(user_id: str) -> InferenceSettings:
    row = db.fetch_one("SELECT * FROM user_inference_settings WHERE user_id = ?", (user_id,))
    if not row:
        now = now_iso()
        monthly_credit = float(os.getenv("VERXIO_DEFAULT_MONTHLY_CREDIT_USD", "0") or "0")
        db.execute(
            """
            INSERT INTO user_inference_settings (
                user_id, mode, default_model_id, monthly_credit_usd,
                overage_enabled, spending_limit_usd, created_at, updated_at
            )
            VALUES (?, 'hosted', ?, ?, 0, NULL, ?, ?)
            """,
            (user_id, DEFAULT_MODEL_ID, monthly_credit, now, now),
        )
        row = db.fetch_one("SELECT * FROM user_inference_settings WHERE user_id = ?", (user_id,))

    return _settings_from_row(row or {})


def _settings_from_row(row: dict[str, Any]) -> InferenceSettings:
    model = _model_by_id(str(row.get("default_model_id") or DEFAULT_MODEL_ID))
    mode = str(row.get("mode") or "hosted")
    if mode not in {"hosted", "byok"}:
        mode = "hosted"
    spending_limit = row.get("spending_limit_usd")
    return InferenceSettings(
        mode=mode,  # type: ignore[arg-type]
        defaultModelId=model.id,
        monthlyCreditUsd=float(row.get("monthly_credit_usd") or 0),
        overageEnabled=bool(row.get("overage_enabled") or 0),
        spendingLimitUsd=float(spending_limit) if spending_limit is not None else None,
    )


def update_inference_settings(user_id: str, payload: InferenceSettingsUpdate) -> InferenceSettings:
    current = ensure_inference_settings(user_id)
    next_mode = payload.mode or current.mode
    next_model = _model_by_id(payload.defaultModelId or current.defaultModelId)
    next_overage = current.overageEnabled if payload.overageEnabled is None else payload.overageEnabled
    next_spending_limit = current.spendingLimitUsd if payload.spendingLimitUsd is None else payload.spendingLimitUsd
    now = now_iso()
    db.execute(
        """
        UPDATE user_inference_settings
        SET mode = ?, default_model_id = ?, overage_enabled = ?, spending_limit_usd = ?, updated_at = ?
        WHERE user_id = ?
        """,
        (next_mode, next_model.id, 1 if next_overage else 0, next_spending_limit, now, user_id),
    )
    return ensure_inference_settings(user_id)


def inference_usage(user_id: str) -> InferenceUsageResponse:
    settings = ensure_inference_settings(user_id)
    row = db.fetch_one(
        """
        SELECT COUNT(*) AS events, COALESCE(SUM(billed_cost_usd), 0) AS used_usd
        FROM usage_events
        WHERE user_id = ? AND mode = 'hosted'
        """,
        (user_id,),
    )
    used = float((row or {}).get("used_usd") or 0)
    monthly_credit = settings.monthlyCreditUsd
    return InferenceUsageResponse(
        settings=settings,
        usage=InferenceUsageSummary(
            monthlyCreditUsd=monthly_credit,
            usedUsd=used,
            remainingUsd=max(monthly_credit - used, 0),
            events=int((row or {}).get("events") or 0),
        ),
    )


def runtime_env_for_user(user_id: str) -> dict[str, str]:
    settings = ensure_inference_settings(user_id)
    if settings.mode != "hosted":
        return {}

    model = _model_by_id(settings.defaultModelId)
    _secret_name, secret_value = _hosted_secret(model)
    if not secret_value:
        return {}

    return {model.runtime_env_var: secret_value}


def _state_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / ".verxio" / BRIDGE_STATE_FILE


def _config_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / "config.yaml"


def _read_runtime_config(runtime: RuntimeInstance) -> dict[str, Any]:
    path = _config_path(runtime)
    if not path.exists():
        return {}
    payload = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
    return payload if isinstance(payload, dict) else {}


def _write_runtime_config(runtime: RuntimeInstance, config: dict[str, Any]) -> None:
    path = _config_path(runtime)
    path.write_text(yaml.safe_dump(config, sort_keys=False), encoding="utf-8")


def _signature(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def _hashed_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _runtime_env_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / ".env"


def _runtime_auth_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / "auth.json"


def _strip_legacy_env_vars_from_dotenv(env_path: Path) -> bool:
    if not env_path.is_file():
        return False

    legacy_prefixes = tuple(f"{name}=" for name in LEGACY_HOSTED_RUNTIME_ENV_VARS)
    original = env_path.read_text(encoding="utf-8")
    kept: list[str] = []
    removed = False

    for line in original.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and stripped.startswith(legacy_prefixes):
            removed = True
            continue
        kept.append(line)

    if not removed:
        return False

    body = "\n".join(kept)
    if body and not body.endswith("\n"):
        body += "\n"
    env_path.write_text(body, encoding="utf-8")
    return True


def _strip_legacy_providers_from_auth(auth_path: Path) -> bool:
    if not auth_path.is_file():
        return False

    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception:
        return False

    if not isinstance(payload, dict):
        return False

    changed = False
    legacy_env_sources = {f"env:{name}" for name in LEGACY_HOSTED_RUNTIME_ENV_VARS}
    pool = payload.get("credential_pool")
    if isinstance(pool, dict):
        for slug in LEGACY_HOSTED_PROVIDER_SLUGS:
            entries = pool.get(slug)
            if not isinstance(entries, list):
                continue
            filtered = [
                entry
                for entry in entries
                if not (
                    isinstance(entry, dict)
                    and str(entry.get("source") or "") in legacy_env_sources
                )
            ]
            if len(filtered) != len(entries):
                changed = True
                if filtered:
                    pool[slug] = filtered
                else:
                    pool.pop(slug, None)

    active_provider = str(payload.get("active_provider") or "")
    if active_provider in LEGACY_HOSTED_PROVIDER_SLUGS:
        pool = payload.get("credential_pool")
        if not isinstance(pool, dict) or active_provider not in pool:
            payload["active_provider"] = ""
            changed = True

    if not changed:
        return False

    payload["updated_at"] = now_iso()
    auth_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return True


def cleanup_legacy_hosted_credentials(runtime: RuntimeInstance) -> bool:
    """Remove Verxio-GPT-era hosted OpenAI credentials from a runtime Hermes home."""
    ensure_runtime_directories(runtime)
    changed = _strip_legacy_env_vars_from_dotenv(_runtime_env_path(runtime))
    changed = _strip_legacy_providers_from_auth(_runtime_auth_path(runtime)) or changed
    return changed


def sync_inference_runtime_bridge(runtime: RuntimeInstance, user_id: str) -> InferenceRuntimeBridgeStatus:
    ensure_runtime_directories(runtime)
    settings = ensure_inference_settings(user_id)
    model = _model_by_id(settings.defaultModelId)
    secret_name, secret_value = _hosted_secret(model)
    missing = [] if secret_value else list(model.hosted_secret_env)

    upstream_model_id = _upstream_model_id(model)

    if settings.mode != "hosted":
        return InferenceRuntimeBridgeStatus(
            configured=True,
            enabled=False,
            changed=False,
            mode=settings.mode,
            defaultModelId=settings.defaultModelId,
            providerSlug=model.provider_slug,
            upstreamModelId=upstream_model_id,
            message="BYOK mode uses Hermes provider settings.",
        )

    legacy_credentials_cleaned = cleanup_legacy_hosted_credentials(runtime)

    if not secret_value:
        return InferenceRuntimeBridgeStatus(
            configured=False,
            enabled=False,
            changed=legacy_credentials_cleaned,
            mode=settings.mode,
            defaultModelId=model.id,
            providerSlug=model.provider_slug,
            upstreamModelId=upstream_model_id,
            missingEnvVars=missing,
            message=f"{model.display_name} needs a hosted provider key.",
        )

    config = _read_runtime_config(runtime)
    raw_model = config.get("model")
    model_invalid = (
        not isinstance(raw_model, dict)
        or not str(raw_model.get("default") or "").strip()
    )
    model_config = raw_model if isinstance(raw_model, dict) else {}
    model_config["provider"] = model.provider_slug
    model_config["default"] = upstream_model_id
    config["model"] = model_config

    signature_payload = {
        "catalog_version": CATALOG_VERSION,
        "mode": settings.mode,
        "default_model_id": model.id,
        "provider_slug": model.provider_slug,
        "upstream_model_id": upstream_model_id,
        "runtime_env_var": model.runtime_env_var,
        "hosted_secret_env": secret_name,
        "hosted_secret_hash": _hashed_secret(secret_value),
    }
    signature = _signature(signature_payload)
    state_path = _state_path(runtime)
    previous_signature = ""
    if state_path.exists():
        try:
            previous_signature = json.loads(state_path.read_text(encoding="utf-8")).get("signature", "")
        except Exception:
            previous_signature = ""

    config_changed = previous_signature != signature
    changed = config_changed or legacy_credentials_cleaned or model_invalid
    if config_changed or model_invalid:
        _write_runtime_config(runtime, config)
        state_path.parent.mkdir(parents=True, exist_ok=True)
        state_path.write_text(
            json.dumps(
                {
                    "signature": signature,
                    "payload": {**signature_payload, "hosted_secret_hash": "<redacted>"},
                    "updated_at": now_iso(),
                },
                indent=2,
                sort_keys=True,
            ),
            encoding="utf-8",
        )

    return InferenceRuntimeBridgeStatus(
        configured=True,
        enabled=True,
        changed=changed,
        mode=settings.mode,
        defaultModelId=model.id,
        providerSlug=model.provider_slug,
        upstreamModelId=upstream_model_id,
    )
