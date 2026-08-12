from __future__ import annotations

import hashlib
import importlib
import json
import os
import sys
import tempfile
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterator

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
HOSTED_QWEN_MODELS_ENV = "VERXIO_HOSTED_QWEN_MODELS"
DEFAULT_GEMINI_UPSTREAM_MODEL = "gemini-flash-lite-latest"
HOSTED_GEMINI_MODEL_ENV = "VERXIO_HOSTED_GEMINI_MODEL"
HOSTED_GEMINI_MODELS_ENV = "VERXIO_HOSTED_GEMINI_MODELS"
CATALOG_VERSION = "2026-07-01"
BRIDGE_STATE_FILE = "inference-runtime-bridge.json"

FALLBACK_QWEN_AVAILABLE_MODELS = (
    DEFAULT_QWEN_UPSTREAM_MODEL,
    "qwen3.7-max",
    "qwen3.7-plus",
    "qwen3.5-plus",
    "qwen3.6-coder",
    "qwen3.6-max",
    "qwen3.6-flash",
    "qwen3-coder-plus",
    "qwen3-coder-next",
    "kimi-k2.5",
    "glm-5",
    "glm-4.7",
    "MiniMax-M2.5",
)
FALLBACK_GEMINI_AVAILABLE_MODELS = (
    DEFAULT_GEMINI_UPSTREAM_MODEL,
    "gemini-3.1-flash-lite",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-3.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-pro",
    "gemini-3-pro",
    "gemini-3-flash",
    "gemini-flash",
)

# Verxio GPT hosted injected these into runtime containers. Strip them when Qwen
# hosted is active so the model picker does not keep showing OpenAI API.
LEGACY_HOSTED_RUNTIME_ENV_VARS = ("OPENAI_API_KEY",)
LEGACY_HOSTED_PROVIDER_SLUGS = ("openai-api",)
HOSTED_RUNTIME_ENV_VARS = ("DASHSCOPE_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")


@dataclass(frozen=True)
class HostedModelDefinition:
    id: str
    display_name: str
    description: str
    provider_slug: str
    upstream_model_default: str
    upstream_model_env: str | None
    available_models_fallback: tuple[str, ...]
    available_models_env: str | None
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


def _csv_env_values(name: str | None) -> tuple[str, ...]:
    if not name:
        return ()

    return tuple(item.strip() for item in os.getenv(name, "").split(",") if item.strip())


def _available_model_ids(model: HostedModelDefinition) -> list[str]:
    upstream = _upstream_model_id(model)
    seen: set[str] = set()
    ordered: list[str] = []
    hermes_models = _hermes_provider_model_ids(model)

    for model_id in (upstream, *_csv_env_values(model.available_models_env), *hermes_models, *model.available_models_fallback):
        if model_id and model_id not in seen:
            seen.add(model_id)
            ordered.append(model_id)

    return ordered


def _hermes_repo_path() -> Path:
    explicit = os.getenv("VERXIO_HERMES_REPO", "").strip()
    if explicit:
        return Path(explicit).expanduser()

    local_repo = Path(__file__).resolve().parents[2] / "hermes-agent"
    if local_repo.is_dir():
        return local_repo

    return Path("/opt/hermes-agent")


@contextmanager
def _temporary_env(values: dict[str, str]) -> Iterator[None]:
    previous = {name: os.environ.get(name) for name in values}
    try:
        for name, value in values.items():
            if value:
                os.environ[name] = value
        yield
    finally:
        for name, value in previous.items():
            if value is None:
                os.environ.pop(name, None)
            else:
                os.environ[name] = value


def _hermes_provider_model_ids(model: HostedModelDefinition) -> tuple[str, ...]:
    """Use Hermes' provider catalog instead of maintaining a Verxio fork."""
    repo = _hermes_repo_path()
    if repo.is_dir():
        repo_str = str(repo)
        if repo_str not in sys.path:
            sys.path.insert(0, repo_str)

    try:
        models = importlib.import_module("hermes_cli.models")
        provider_model_ids = getattr(models, "provider_model_ids")
        _secret_name, secret_value = _hosted_secret(model)
        hermes_env = {
            env_name: secret_value
            for env_name in (model.runtime_env_var, *model.byok_env_vars)
            if secret_value
        }
        with _temporary_env(hermes_env):
            model_ids = provider_model_ids(model.provider_slug, force_refresh=bool(secret_value))
        return tuple(str(model_id) for model_id in model_ids if str(model_id).strip())
    except Exception:
        return ()


MODEL_CATALOG: tuple[HostedModelDefinition, ...] = (
    HostedModelDefinition(
        id="verxio-qwen",
        display_name="Verxio Qwen",
        description="Hosted Qwen Cloud through Alibaba DashScope for fast coding and long-context agent work.",
        provider_slug="alibaba",
        upstream_model_default=DEFAULT_QWEN_UPSTREAM_MODEL,
        upstream_model_env=HOSTED_QWEN_MODEL_ENV,
        available_models_fallback=FALLBACK_QWEN_AVAILABLE_MODELS,
        available_models_env=HOSTED_QWEN_MODELS_ENV,
        hosted_secret_env=("VERXIO_HOSTED_QWEN_API_KEY", "VERXIO_DASHSCOPE_API_KEY"),
        runtime_env_var="DASHSCOPE_API_KEY",
        byok_env_vars=("DASHSCOPE_API_KEY",),
        tier="balanced",
        input_per_million=0.8,
        output_per_million=2.4,
        capabilities=(("coding", "Coding"), ("long_context", "Long context"), ("tools", "Tool use")),
    ),
    HostedModelDefinition(
        id="verxio-gemini",
        display_name="Verxio Gemini",
        description="Hosted Gemini through Google AI Studio for fast, low-cost agent turns.",
        provider_slug="gemini",
        upstream_model_default=DEFAULT_GEMINI_UPSTREAM_MODEL,
        upstream_model_env=HOSTED_GEMINI_MODEL_ENV,
        available_models_fallback=FALLBACK_GEMINI_AVAILABLE_MODELS,
        available_models_env=HOSTED_GEMINI_MODELS_ENV,
        hosted_secret_env=("VERXIO_HOSTED_GEMINI_API_KEY", "VERXIO_GOOGLE_API_KEY"),
        runtime_env_var="GEMINI_API_KEY",
        byok_env_vars=("GEMINI_API_KEY", "GOOGLE_API_KEY"),
        tier="fast",
        input_per_million=0.1,
        output_per_million=0.4,
        capabilities=(("coding", "Coding"), ("tools", "Tool use"), ("vision", "Vision")),
    ),
)


def _hosted_provider_slugs() -> tuple[str, ...]:
    return tuple(model.provider_slug for model in MODEL_CATALOG)


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
        availableModelIds=_available_model_ids(model),
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
    """Inject every available Verxio-hosted secret into the runtime.

    Hybrid mode keeps hosted Qwen/Gemini usable alongside BYOK providers, so
    we no longer gate on ``settings.mode`` or a single default family.
    """
    ensure_inference_settings(user_id)
    env: dict[str, str] = {}
    for model in MODEL_CATALOG:
        _secret_name, secret_value = _hosted_secret(model)
        if not secret_value:
            continue
        env[model.runtime_env_var] = secret_value
        # Gemini tooling often reads GOOGLE_API_KEY as an alias.
        if model.runtime_env_var == "GEMINI_API_KEY":
            env.setdefault("GOOGLE_API_KEY", secret_value)
    return env


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
    """Write Hermes config without dropping unrelated on-disk sections.

    Bridge sync historically dumped the in-memory dict with ``write_text``. A
    raced/empty read then persisted a model-only (or agent-only) stub and wiped
    Skills → Toolsets ``image_gen`` / ``video_gen`` pins. Merge with a fresh
    disk read and keep media provider sections when the incoming payload omits
    them.
    """
    path = _config_path(runtime)
    disk = _read_runtime_config(runtime)
    merged: dict[str, Any] = dict(disk)
    merged.update(config)
    # Callers clear a section by setting it to None (update alone cannot delete).
    for key, value in list(merged.items()):
        if value is None:
            merged.pop(key, None)

    for key in ("image_gen", "video_gen"):
        disk_section = disk.get(key)
        incoming = merged.get(key)
        if not isinstance(disk_section, dict):
            continue
        disk_provider = str(disk_section.get("provider") or "").strip()
        if not disk_provider:
            continue
        if incoming is None or not isinstance(incoming, dict) or not str(incoming.get("provider") or "").strip():
            # Only restore media pins when the caller did not explicitly clear them.
            if key in config and config.get(key) is None:
                continue
            merged[key] = dict(disk_section)

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(yaml.safe_dump(merged, sort_keys=False))
            handle.flush()
            os.fsync(handle.fileno())
        tmp_path.replace(path)
    except Exception:
        try:
            tmp_path.unlink(missing_ok=True)
        except OSError:
            pass
        raise


def _signature(payload: dict[str, Any]) -> str:
    body = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(body).hexdigest()


def _hashed_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _runtime_env_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / ".env"


def _runtime_auth_path(runtime: RuntimeInstance) -> Path:
    return Path(runtime.hermes_home_path) / "auth.json"


def _strip_env_vars_from_dotenv(env_path: Path, env_var_names: tuple[str, ...]) -> bool:
    if not env_path.is_file() or not env_var_names:
        return False

    prefixes = tuple(f"{name}=" for name in env_var_names)
    original = env_path.read_text(encoding="utf-8")
    kept: list[str] = []
    removed = False

    for line in original.splitlines():
        stripped = line.strip()
        if stripped and not stripped.startswith("#") and stripped.startswith(prefixes):
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


def _strip_legacy_env_vars_from_dotenv(env_path: Path) -> bool:
    return _strip_env_vars_from_dotenv(env_path, LEGACY_HOSTED_RUNTIME_ENV_VARS + HOSTED_RUNTIME_ENV_VARS)


def _strip_hosted_providers_from_auth(auth_path: Path) -> bool:
    if not auth_path.is_file():
        return False

    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception:
        return False

    if not isinstance(payload, dict):
        return False

    changed = False
    env_sources = {f"env:{name}" for name in LEGACY_HOSTED_RUNTIME_ENV_VARS + HOSTED_RUNTIME_ENV_VARS}
    provider_slugs = LEGACY_HOSTED_PROVIDER_SLUGS + _hosted_provider_slugs()
    pool = payload.get("credential_pool")
    if isinstance(pool, dict):
        for slug in provider_slugs:
            entries = pool.get(slug)
            if not isinstance(entries, list):
                continue
            filtered = [
                entry
                for entry in entries
                if not (
                    isinstance(entry, dict)
                    and str(entry.get("source") or "") in env_sources
                )
            ]
            if len(filtered) != len(entries):
                changed = True
                if filtered:
                    pool[slug] = filtered
                else:
                    pool.pop(slug, None)

    active_provider = str(payload.get("active_provider") or "")
    if active_provider in provider_slugs:
        pool = payload.get("credential_pool")
        if not isinstance(pool, dict) or active_provider not in pool:
            payload["active_provider"] = ""
            changed = True

    if not changed:
        return False

    payload["updated_at"] = now_iso()
    auth_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return True


def _strip_legacy_providers_from_auth(auth_path: Path) -> bool:
    return _strip_hosted_providers_from_auth(auth_path)


def cleanup_legacy_hosted_credentials(runtime: RuntimeInstance) -> bool:
    """Preserve user-managed runtime credentials.

    Older hosted-inference cleanup removed provider env vars from Hermes' `.env`
    to hide stale Verxio-injected keys. That is unsafe now that Tools & Keys uses
    the same file for user-owned credentials such as OPENAI_API_KEY.
    """
    ensure_runtime_directories(runtime)
    return False


def _strip_hosted_model_assignment(runtime: RuntimeInstance, model: HostedModelDefinition) -> bool:
    config = _read_runtime_config(runtime)
    raw_model = config.get("model")
    if not isinstance(raw_model, dict):
        return False

    if str(raw_model.get("provider") or "") != model.provider_slug:
        return False

    raw_model.pop("provider", None)
    raw_model.pop("default", None)
    config["model"] = None if not raw_model else raw_model

    _write_runtime_config(runtime, config)

    state_path = _state_path(runtime)
    if state_path.exists():
        state_path.unlink()

    return True


def _strip_any_hosted_model_assignment(runtime: RuntimeInstance) -> bool:
    """Clear Hermes main-model assignment when it points at a Verxio hosted provider."""
    config = _read_runtime_config(runtime)
    raw_model = config.get("model")
    if not isinstance(raw_model, dict):
        return False

    provider = str(raw_model.get("provider") or "").strip()
    if provider not in set(_hosted_provider_slugs()) and provider not in set(LEGACY_HOSTED_PROVIDER_SLUGS):
        return False

    raw_model.pop("provider", None)
    raw_model.pop("default", None)
    config["model"] = None if not raw_model else raw_model

    _write_runtime_config(runtime, config)

    state_path = _state_path(runtime)
    if state_path.exists():
        state_path.unlink()

    return True


def _strip_verxio_hosted_auth_for_byok(auth_path: Path) -> bool:
    """Clear only Verxio-hosted Alibaba/Gemini env pool entries.

    Does not touch OpenAI/Anthropic (or other) user BYOK credentials that
    happen to live in the same ``auth.json`` credential pool.
    """
    if not auth_path.is_file():
        return False

    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception:
        return False

    if not isinstance(payload, dict):
        return False

    changed = False
    env_sources = {f"env:{name}" for name in HOSTED_RUNTIME_ENV_VARS}
    hosted_slugs = set(_hosted_provider_slugs())
    pool = payload.get("credential_pool")
    if isinstance(pool, dict):
        for slug in list(hosted_slugs):
            entries = pool.get(slug)
            if not isinstance(entries, list):
                continue
            filtered = [
                entry
                for entry in entries
                if not (
                    isinstance(entry, dict)
                    and str(entry.get("source") or "") in env_sources
                )
            ]
            if len(filtered) != len(entries):
                changed = True
                if filtered:
                    pool[slug] = filtered
                else:
                    pool.pop(slug, None)

    active_provider = str(payload.get("active_provider") or "")
    if active_provider in hosted_slugs:
        pool = payload.get("credential_pool")
        if not isinstance(pool, dict) or active_provider not in pool:
            payload["active_provider"] = ""
            changed = True

    if not changed:
        return False

    payload["updated_at"] = now_iso()
    auth_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return True


def _clear_hosted_inference_for_byok(runtime: RuntimeInstance) -> bool:
    """Remove leftover hosted Qwen/Gemini assignment so BYOK starts clean.

    Keeps user-owned ``.env`` API keys (Tools & Keys). Clears config model
    slot + env-sourced hosted auth pool entries so the picker/runtime do not
    keep showing or calling Verxio-hosted defaults.
    """
    ensure_runtime_directories(runtime)
    model_cleaned = _strip_any_hosted_model_assignment(runtime)
    auth_cleaned = _strip_verxio_hosted_auth_for_byok(_runtime_auth_path(runtime))
    state_path = _state_path(runtime)
    state_cleaned = False
    if state_path.exists():
        state_path.unlink()
        state_cleaned = True
    return model_cleaned or auth_cleaned or state_cleaned


def _clear_conflicting_auth_active_provider(auth_path: Path, hosted_provider_slug: str) -> bool:
    """Clear auth.json active_provider when it would steal hosted model resolution.

    Hosted mode pins ``config.yaml`` ``model.provider``. If that section is briefly
    empty (dashboard PUT race, corrupt YAML recovery), Hermes ``resolve_provider('auto')``
    falls through to ``auth.json`` ``active_provider``. A leftover ``openai-codex``
    login then makes Telegram report Codex while Verxio Hosted is Gemini/Qwen.
    Credential pool entries are kept — only the active pointer is cleared.
    """
    if not auth_path.is_file():
        return False

    try:
        payload = json.loads(auth_path.read_text(encoding="utf-8"))
    except Exception:
        return False

    if not isinstance(payload, dict):
        return False

    active = str(payload.get("active_provider") or "").strip().lower()
    if not active:
        return False

    hosted = str(hosted_provider_slug or "").strip().lower()
    if hosted and active == hosted:
        return False

    payload["active_provider"] = ""
    payload["updated_at"] = now_iso()
    auth_path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return True


def _is_byok_model_selection(config: dict[str, Any]) -> bool:
    """True when config.yaml already points at a non-Verxio-hosted provider."""
    raw_model = config.get("model")
    if not isinstance(raw_model, dict):
        return False
    provider = str(raw_model.get("provider") or "").strip().lower()
    default = str(raw_model.get("default") or "").strip()
    if not provider or not default:
        return False
    hosted = set(_hosted_provider_slugs()) | set(LEGACY_HOSTED_PROVIDER_SLUGS)
    return provider not in hosted


def sync_inference_runtime_bridge(runtime: RuntimeInstance, user_id: str) -> InferenceRuntimeBridgeStatus:
    ensure_runtime_directories(runtime)
    settings = ensure_inference_settings(user_id)
    model = _model_by_id(settings.defaultModelId)
    secret_name, secret_value = _hosted_secret(model)
    missing = [] if secret_value else list(model.hosted_secret_env)

    upstream_model_id = _upstream_model_id(model)
    legacy_credentials_cleaned = cleanup_legacy_hosted_credentials(runtime)
    config = _read_runtime_config(runtime)

    # Hybrid: never wipe a connected-provider selection. Hosted secrets stay
    # available via runtime_env_for_user so the picker can switch back anytime.
    if _is_byok_model_selection(config):
        return InferenceRuntimeBridgeStatus(
            configured=True,
            enabled=True,
            changed=legacy_credentials_cleaned,
            mode=settings.mode,
            defaultModelId=settings.defaultModelId,
            providerSlug=model.provider_slug,
            upstreamModelId=upstream_model_id,
            message="Hybrid mode keeps the connected provider selection.",
        )

    if not secret_value:
        # Only clear a stale hosted pin for *this* family when its secret is gone.
        model_assignment_cleaned = _strip_hosted_model_assignment(runtime, model)
        any_hosted_secret = any(_hosted_secret(item)[1] for item in MODEL_CATALOG)
        return InferenceRuntimeBridgeStatus(
            configured=any_hosted_secret,
            enabled=any_hosted_secret,
            changed=legacy_credentials_cleaned or model_assignment_cleaned,
            mode=settings.mode,
            defaultModelId=model.id,
            providerSlug=model.provider_slug,
            upstreamModelId=upstream_model_id,
            missingEnvVars=missing,
            message=(
                f"{model.display_name} needs a hosted provider key."
                if not any_hosted_secret
                else "Hosted default family unavailable; other hosted or BYOK models remain usable."
            ),
        )

    raw_model = config.get("model")
    model_invalid = (
        not isinstance(raw_model, dict)
        or not str(raw_model.get("default") or "").strip()
        or str(raw_model.get("provider") or "").strip().lower() != model.provider_slug
        or str(raw_model.get("default") or "").strip() != upstream_model_id
    )
    model_config = raw_model if isinstance(raw_model, dict) else {}
    model_config["provider"] = model.provider_slug
    model_config["default"] = upstream_model_id
    config["model"] = model_config

    auth_active_cleared = _clear_conflicting_auth_active_provider(
        _runtime_auth_path(runtime), model.provider_slug
    )

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
    changed = (
        config_changed
        or legacy_credentials_cleaned
        or model_invalid
        or auth_active_cleared
    )
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
