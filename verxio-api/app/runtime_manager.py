from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import secrets
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

from app import db
from app.control_plane import ensure_runtime_directories, now_iso, runtime_from_row, safe_path_part, save_runtime
from app.models import ArtifactRecord, RuntimeInstance, new_id


# Hot-path caches: sync docker.sock calls on every /api/status poll freeze the
# whole uvicorn event loop on ECS (auth/me waits 20s+, boot spinner hangs).
_NETWORK_CACHE: str | None = None
_NETWORK_CACHE_LOADED = False
_NETWORK_ATTACHED_CACHE: set[str] = set()
_CONTAINER_IP_CACHE: dict[str, tuple[float, str]] = {}
_LIVE_TOKEN_CACHE: dict[str, tuple[float, str]] = {}
_CONTAINER_ENV_CACHE: dict[str, tuple[float, dict[str, str]]] = {}
_HEALTHY_UNTIL: dict[str, float] = {}
_START_LOCKS: dict[str, asyncio.Lock] = {}
_CACHE_TTL_SECONDS = 60.0
_HEALTHY_TTL_SECONDS = 45.0
_OPTIONAL_UNPAIRED_PLATFORM_ERRORS = {
    "whatsapp": {"whatsapp_not_paired"},
}
_ARTIFACT_FILE_EXTENSIONS = {
    ".bmp",
    ".aac",
    ".csv",
    ".doc",
    ".docx",
    ".flac",
    ".gif",
    ".htm",
    ".html",
    ".jpeg",
    ".jpg",
    ".json",
    ".jsonl",
    ".m4a",
    ".md",
    ".mov",
    ".mp3",
    ".mp4",
    ".ogg",
    ".parquet",
    ".pdf",
    ".png",
    ".ppt",
    ".pptx",
    ".svg",
    ".tsv",
    ".txt",
    ".wav",
    ".webp",
    ".webm",
    ".xls",
    ".xlsx",
    ".zip",
}
_WORKSPACE_ARTIFACT_DIR_NAMES = {
    "artifacts",
    "charts",
    "downloads",
    "exports",
    "generated",
    "images",
    "output",
    "outputs",
    "reports",
}
_WORKSPACE_ARTIFACT_SKIP_DIRS = {
    ".cache",
    ".git",
    ".hg",
    ".next",
    ".nuxt",
    ".pytest_cache",
    ".turbo",
    ".venv",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "vendor",
    "venv",
}
# Hard cap so a generated React app cannot freeze /api/artifacts (and make the
# web UI parse an HTML error page as JSON).
_MAX_INDEXED_ARTIFACT_FILES = 2_000
_MAX_ARTIFACT_HASH_BYTES = 32 * 1024 * 1024
_RUNTIME_HOME_ARTIFACT_PREFIX = "runtime-home/artifacts/"
_TRUTHY_ENV_VALUES = {"1", "true", "yes", "on"}


def _is_optional_unpaired_exit_reason(reason: Any) -> bool:
    if not isinstance(reason, str):
        return False
    lower = reason.lower()
    return any(platform_id in lower and "not paired" in lower for platform_id in _OPTIONAL_UNPAIRED_PLATFORM_ERRORS)


def _env_truthy(value: str | None) -> bool:
    return (value or "").strip().lower() in _TRUTHY_ENV_VALUES


def _runtime_whatsapp_paired(runtime: RuntimeInstance) -> bool:
    hermes_home = Path(runtime.hermes_home_path)
    return any(
        path.is_file()
        for path in (
            hermes_home / "platforms" / "whatsapp" / "session" / "creds.json",
            hermes_home / "whatsapp" / "session" / "creds.json",
        )
    )


def _verxio_api_internal_url() -> str:
    """Base URL the Hermes container uses to call verxio-api (Notepad, etc.)."""
    return (
        os.getenv("VERXIO_API_INTERNAL_URL", "").strip()
        or os.getenv("VERXIO_API_URL", "").strip()
        or "http://verxio-api:8787"
    )


def _runtime_container_env(runtime: RuntimeInstance, extra_env: dict[str, str] | None = None) -> dict[str, str]:
    env: dict[str, str] = {
        "VERXIO_HOSTED": "1",
        "WHATSAPP_BROWSER_NAME": "Verxio Agent",
        "WHATSAPP_REPLY_PREFIX": "",
        # Lets Hermes tools reach the Verxio control plane (Notepad, shares).
        "VERXIO_API_URL": _verxio_api_internal_url(),
        "VERXIO_WORKSPACE_ID": runtime.workspace_id,
        "VERXIO_AGENT_ID": runtime.agent_id,
        "VERXIO_PUBLIC_WEB_URL": os.getenv("VERXIO_PUBLIC_WEB_URL", "http://127.0.0.1:8080").strip(),
    }

    if not _runtime_whatsapp_paired(runtime):
        env["WHATSAPP_ENABLED"] = "false"

    for key, value in (extra_env or {}).items():
        if key and value:
            env[str(key)] = str(value)

    # A stale config/.env can mark WhatsApp enabled before the QR/session exists.
    # In hosted runtimes that must not take Slack, web chat, cron, or tools down.
    if _env_truthy(env.get("WHATSAPP_ENABLED")) and not _runtime_whatsapp_paired(runtime):
        env["WHATSAPP_ENABLED"] = "false"

    return env


def normalize_gateway_status_payload(payload: Any) -> Any:
    """Hide optional unpaired channel state from runtime health/status UI.

    A user can connect Slack without pairing WhatsApp. The gateway still reports
    WhatsApp as fatal when its platform config is present but no local pairing
    session exists; that should not make the hosted Verxio runtime look down.
    """

    if not isinstance(payload, dict):
        return payload

    normalized = dict(payload)
    changed = False

    if _is_optional_unpaired_exit_reason(payload.get("gateway_exit_reason")):
        normalized["gateway_running"] = True
        normalized["gateway_state"] = "ready"
        normalized["gateway_exit_reason"] = None
        changed = True

    platforms = payload.get("gateway_platforms")
    if not isinstance(platforms, dict):
        return normalized if changed else payload

    normalized_platforms: dict[str, Any] = dict(platforms)

    for platform_id, optional_errors in _OPTIONAL_UNPAIRED_PLATFORM_ERRORS.items():
        status = normalized_platforms.get(platform_id)
        if not isinstance(status, dict):
            continue
        if status.get("error_code") not in optional_errors:
            continue

        next_status = dict(status)
        next_status["state"] = "not_configured"
        next_status["configured"] = False
        next_status["enabled"] = False
        next_status["error_code"] = None
        next_status["error_message"] = None
        normalized_platforms[platform_id] = next_status
        changed = True

    normalized["gateway_platforms"] = normalized_platforms
    return normalized if changed else payload


def normalize_gateway_status_content(content: bytes) -> bytes:
    try:
        payload = json.loads(content.decode("utf-8"))
    except Exception:
        return content

    normalized = normalize_gateway_status_payload(payload)
    if normalized == payload:
        return content

    return json.dumps(normalized, separators=(",", ":")).encode("utf-8")


def _sha256_file(path: Path) -> str:
    import hashlib

    try:
        size = path.stat().st_size
        if size > _MAX_ARTIFACT_HASH_BYTES:
            return f"size:{size}"
    except OSError:
        return "unavailable"

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _file_mtime_iso(stat_result: os.stat_result) -> str:
    """Stable artifact timestamps from disk mtime (not index wall-clock)."""
    return datetime.fromtimestamp(stat_result.st_mtime, tz=timezone.utc).isoformat()


_ARTIFACT_SOURCE_RANK = {
    "workspace": 3,
    "workspace_root": 2,
    "runtime_home": 1,
}


def _artifact_list_preference(row: dict[str, Any]) -> tuple:
    """Higher tuple wins when collapsing byte-identical artifact rows."""
    source = str(row.get("source") or "")
    name = str(row.get("file_name") or "")
    relative = str(row.get("relative_path") or "")
    return (
        _ARTIFACT_SOURCE_RANK.get(source, 0),
        0 if relative.startswith(_RUNTIME_HOME_ARTIFACT_PREFIX) else 1,
        1 if "final" in name.lower() else 0,
        str(row.get("updated_at") or ""),
        str(row.get("created_at") or ""),
        # Stable tie-break so preference is deterministic across runs.
        str(row.get("id") or ""),
    )


def _dedupe_artifact_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse byte-identical files (same sha256) for the Artifacts UI.

    Keeps one preferred row per digest so workspace↔runtime-home mirrors and
    renamed copies of the same bytes do not clutter the list. Near-identical
    regenerations with different hashes are intentionally kept (those were
    separate paid gens).
    """
    best_by_digest: dict[str, dict[str, Any]] = {}
    for row in rows:
        digest = str(row.get("sha256") or "").strip()
        if not digest:
            continue
        current = best_by_digest.get(digest)
        if current is None or _artifact_list_preference(row) > _artifact_list_preference(current):
            best_by_digest[digest] = row

    seen: set[str] = set()
    deduped: list[dict[str, Any]] = []
    for row in rows:
        digest = str(row.get("sha256") or "").strip()
        if not digest:
            public = {key: value for key, value in row.items() if key != "sha256"}
            deduped.append(public)
            continue
        if digest in seen:
            continue
        winner = best_by_digest[digest]
        if winner.get("id") != row.get("id"):
            continue
        seen.add(digest)
        deduped.append({key: value for key, value in winner.items() if key != "sha256"})
    return deduped


def _artifact_path_is_skipped(relative: Path) -> bool:
    return any(part in _WORKSPACE_ARTIFACT_SKIP_DIRS for part in relative.parts)


def _iter_files_skipping_dirs(root: Path):
    """Yield files under root without descending into dependency/build trees.

    Path.rglob still visits every path under node_modules before a skip check,
    which is what wedged /api/artifacts after a React scaffold.
    """
    if not root.is_dir():
        return
    for dirpath, dirnames, filenames in os.walk(root, followlinks=False):
        dirnames[:] = [name for name in dirnames if name not in _WORKSPACE_ARTIFACT_SKIP_DIRS]
        current = Path(dirpath)
        for name in filenames:
            yield current / name


def _docker_binary() -> str:
    return os.getenv("VERXIO_DOCKER_BIN", "docker")


def _docker_timeout_seconds(args: list[str]) -> float:
    """Bound docker.sock waits so a wedged daemon cannot hang the API forever."""
    action = args[0] if args else ""
    if action == "run":
        raw = os.getenv("VERXIO_DOCKER_RUN_TIMEOUT_SECONDS", "180").strip()
        default = 180.0
    elif action in {"start", "stop", "restart", "rm", "network"}:
        raw = os.getenv("VERXIO_DOCKER_MUTATE_TIMEOUT_SECONDS", "60").strip()
        default = 60.0
    else:
        raw = os.getenv("VERXIO_DOCKER_INSPECT_TIMEOUT_SECONDS", "20").strip()
        default = 20.0
    try:
        return max(5.0, float(raw))
    except ValueError:
        return default


def _run_docker(args: list[str]) -> subprocess.CompletedProcess[str]:
    timeout = _docker_timeout_seconds(args)
    try:
        return subprocess.run(
            [_docker_binary(), *args],
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
    except subprocess.TimeoutExpired as exc:
        stderr = exc.stderr if isinstance(exc.stderr, str) else (exc.stderr or b"").decode("utf-8", "replace")
        stdout = exc.stdout if isinstance(exc.stdout, str) else (exc.stdout or b"").decode("utf-8", "replace")
        return subprocess.CompletedProcess(
            args=[_docker_binary(), *args],
            returncode=124,
            stdout=stdout,
            stderr=stderr or f"docker {' '.join(args[:2])} timed out after {timeout:.0f}s",
        )


async def _run_docker_async(args: list[str]) -> subprocess.CompletedProcess[str]:
    return await asyncio.to_thread(_run_docker, args)


def _container_name(runtime: RuntimeInstance) -> str:
    if runtime.container_name:
        return runtime.container_name
    return f"verxio-{safe_path_part(runtime.workspace_id)}-{safe_path_part(runtime.agent_id)}"


def _cache_get(cache: dict[str, tuple[float, str]], key: str) -> str | None:
    item = cache.get(key)
    if not item:
        return None
    expires_at, value = item
    if time.monotonic() >= expires_at:
        cache.pop(key, None)
        return None
    return value


def _cache_set(cache: dict[str, tuple[float, str]], key: str, value: str, ttl: float = _CACHE_TTL_SECONDS) -> None:
    cache[key] = (time.monotonic() + ttl, value)


def mark_runtime_healthy(runtime: RuntimeInstance, ttl: float = _HEALTHY_TTL_SECONDS) -> None:
    _HEALTHY_UNTIL[_container_name(runtime)] = time.monotonic() + ttl


def runtime_recently_healthy(runtime: RuntimeInstance) -> bool:
    until = _HEALTHY_UNTIL.get(_container_name(runtime), 0.0)
    return time.monotonic() < until


def invalidate_runtime_caches(runtime: RuntimeInstance) -> None:
    name = _container_name(runtime)
    _CONTAINER_IP_CACHE.pop(name, None)
    _LIVE_TOKEN_CACHE.pop(name, None)
    _CONTAINER_ENV_CACHE.pop(name, None)
    _HEALTHY_UNTIL.pop(name, None)


def _runtime_container_env_map(runtime: RuntimeInstance) -> dict[str, str] | None:
    """Read all container env vars once (cached) — avoids repeated docker inspect."""

    name = _container_name(runtime)
    cached = _CONTAINER_ENV_CACHE.get(name)
    if cached:
        expires_at, env_map = cached
        if time.monotonic() < expires_at:
            return env_map
        _CONTAINER_ENV_CACHE.pop(name, None)

    result = _run_docker(
        [
            "inspect",
            "-f",
            "{{range .Config.Env}}{{println .}}{{end}}",
            name,
        ]
    )
    if result.returncode != 0:
        return None

    env_map: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" not in line:
            continue
        key, value = line.split("=", 1)
        env_map[key] = value
    _CONTAINER_ENV_CACHE[name] = (time.monotonic() + _CACHE_TTL_SECONDS, env_map)
    return env_map


def runtime_container_env_value(runtime: RuntimeInstance, key: str) -> str | None:
    """Return an env value from the running runtime container, if present."""

    if not key:
        return None

    env_map = _runtime_container_env_map(runtime)
    if env_map is None:
        return None
    return env_map.get(key)


def runtime_container_env_matches(runtime: RuntimeInstance, key: str, expected_value: str) -> bool:
    """Return True when the running runtime container has the expected env value."""

    if not expected_value:
        return False
    return runtime_container_env_value(runtime, key) == expected_value


def runtime_live_dashboard_token(runtime: RuntimeInstance, fallback: str = "") -> str:
    """Prefer the token Hermes was actually started with over the DB copy."""

    name = _container_name(runtime)
    cached = _cache_get(_LIVE_TOKEN_CACHE, name)
    if cached:
        return cached

    live = runtime_container_env_value(runtime, "HERMES_DASHBOARD_SESSION_TOKEN")
    if live:
        _cache_set(_LIVE_TOKEN_CACHE, name, live)
        return live
    return fallback


async def runtime_live_dashboard_token_async(runtime: RuntimeInstance, fallback: str = "") -> str:
    """Async variant so WS auth never blocks the uvicorn event loop."""

    name = _container_name(runtime)
    cached = _cache_get(_LIVE_TOKEN_CACHE, name)
    if cached:
        return cached
    return await asyncio.to_thread(runtime_live_dashboard_token, runtime, fallback)


def _port_is_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) != 0


def _docker_published_port_in_use(port: int) -> bool:
    result = _run_docker(["ps", "--format", "{{.Ports}}"])
    if result.returncode != 0:
        return False

    needle = f":{port}->"
    return any(needle in line for line in result.stdout.splitlines())


def _runtime_publish_port_is_free(port: int) -> bool:
    return _port_is_free(port) and not _docker_published_port_in_use(port)


def _allocate_port() -> int:
    start = int(os.getenv("VERXIO_DASHBOARD_PORT_START", "19119"))
    for port in range(start, start + 1000):
        if _runtime_publish_port_is_free(port):
            return port
    raise RuntimeError("No free localhost dashboard port found for a Verxio runtime.")


def _dashboard_port(runtime: RuntimeInstance) -> int:
    if runtime.dashboard_url:
        parsed = urlparse(runtime.dashboard_url)
        if parsed.port:
            return parsed.port
    return _allocate_port()


def _dashboard_port_for_start(runtime: RuntimeInstance) -> int:
    stored_port = _dashboard_port(runtime)
    if _runtime_publish_port_is_free(stored_port):
        return stored_port
    return _allocate_port()


def _runtime_connect_host() -> str:
    return os.getenv("VERXIO_RUNTIME_CONNECT_HOST", "127.0.0.1").strip() or "127.0.0.1"


def _runtime_publish_host() -> str:
    return os.getenv("VERXIO_RUNTIME_PUBLISH_HOST", "127.0.0.1").strip() or "127.0.0.1"


def _self_container_ref() -> str | None:
    """Best-effort id/name for the container running this process."""
    # Compose sets hostname to the container id (or service name).
    hostname = socket.gethostname().strip()
    if hostname:
        return hostname

    try:
        with open("/proc/self/cgroup", encoding="utf-8") as handle:
            text = handle.read()
    except OSError:
        return None

    for marker in ("/docker/", "/docker-ce/docker/", "/cri-containerd-"):
        if marker not in text:
            continue
        for part in text.replace("\n", "/").split("/"):
            if len(part) >= 12 and all(ch in "0123456789abcdef" for ch in part[:12]):
                return part
    return None


def _runtime_docker_network(*, allow_docker_probe: bool = True) -> str | None:
    """Docker network shared with verxio-api (so HTTP + WS reach Hermes).

    Prefer ``VERXIO_RUNTIME_DOCKER_NETWORK``. Otherwise inspect this process's
    container networks (works when the API itself runs in Docker Compose).

    Hot HTTP paths must pass ``allow_docker_probe=False`` so a slow docker.sock
    inspect cannot freeze the uvicorn event loop.
    """
    global _NETWORK_CACHE, _NETWORK_CACHE_LOADED
    if _NETWORK_CACHE_LOADED:
        return _NETWORK_CACHE

    explicit = os.getenv("VERXIO_RUNTIME_DOCKER_NETWORK", "").strip()
    if explicit:
        _NETWORK_CACHE = explicit
        _NETWORK_CACHE_LOADED = True
        return _NETWORK_CACHE

    if not allow_docker_probe:
        return None

    self_ref = _self_container_ref()
    if not self_ref:
        _NETWORK_CACHE_LOADED = True
        return None

    result = _run_docker(
        [
            "inspect",
            "-f",
            "{{range $k, $v := .NetworkSettings.Networks}}{{println $k}}{{end}}",
            self_ref,
        ]
    )
    if result.returncode != 0:
        _NETWORK_CACHE_LOADED = True
        return None

    networks = [line.strip() for line in result.stdout.splitlines() if line.strip()]
    for name in networks:
        if "verxio" in name or name.endswith("_default"):
            _NETWORK_CACHE = name
            _NETWORK_CACHE_LOADED = True
            return _NETWORK_CACHE
    _NETWORK_CACHE = networks[0] if networks else None
    _NETWORK_CACHE_LOADED = True
    return _NETWORK_CACHE


async def warm_runtime_docker_network() -> str | None:
    """Resolve and cache the compose network off the event loop."""

    return await asyncio.to_thread(_runtime_docker_network, allow_docker_probe=True)


def _ensure_runtime_on_network(runtime: RuntimeInstance) -> None:
    """Attach an already-running runtime to the API compose network if needed."""
    network = _runtime_docker_network()
    if not network:
        return

    name = _container_name(runtime)
    cache_key = f"{network}:{name}"
    if cache_key in _NETWORK_ATTACHED_CACHE:
        return

    check = _run_docker(
        [
            "inspect",
            "-f",
            f"{{{{index .NetworkSettings.Networks \"{network}\"}}}}",
            name,
        ]
    )
    # Empty / <no value> means not attached.
    attached = check.returncode == 0 and check.stdout.strip() not in {"", "<no value>", "map[]"}
    if attached:
        _NETWORK_ATTACHED_CACHE.add(cache_key)
        return

    result = _run_docker(["network", "connect", network, name])
    if result.returncode == 0 or "already exists" in result.stderr.lower():
        _NETWORK_ATTACHED_CACHE.add(cache_key)
    invalidate_runtime_caches(runtime)


def _runtime_container_ip(runtime: RuntimeInstance) -> str | None:
    """IP of the runtime on the preferred shared network, else any bridge IP."""
    name = _container_name(runtime)
    cached = _cache_get(_CONTAINER_IP_CACHE, name)
    if cached:
        return cached

    network = _runtime_docker_network()
    if network:
        result = _run_docker(
            [
                "inspect",
                "-f",
                f"{{{{(index .NetworkSettings.Networks \"{network}\").IPAddress}}}}",
                name,
            ]
        )
        if result.returncode == 0:
            ip = result.stdout.strip()
            if ip and ip not in {"<no value>", "<nil>"}:
                _cache_set(_CONTAINER_IP_CACHE, name, ip)
                return ip

    result = _run_docker(
        [
            "inspect",
            "-f",
            "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}",
            name,
        ]
    )
    if result.returncode != 0:
        return None
    ip = result.stdout.strip()
    if ip:
        _cache_set(_CONTAINER_IP_CACHE, name, ip)
    return ip or None


def runtime_webhook_container_port() -> int:
    return int(os.getenv("VERXIO_WEBHOOK_PORT", "8644") or "8644")


def runtime_api_server_container_port() -> int:
    return int(os.getenv("VERXIO_API_SERVER_PORT", "8642") or "8642")


def runtime_webhook_base_url(runtime: RuntimeInstance, *, ensure_network: bool = False) -> str | None:
    """Private URL the API uses to reach the runtime webhook listener."""
    manager = (runtime.manager or os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()
    port = runtime_webhook_container_port()
    if manager in {"k8s", "kubernetes"}:
        dashboard = runtime.dashboard_url or ""
        if dashboard:
            from urllib.parse import urlparse, urlunparse

            parsed = urlparse(dashboard)
            host = parsed.hostname or ""
            if host and parsed.port == 9119:
                netloc = f"{host}:{port}"
                return urlunparse(parsed._replace(netloc=netloc))
        return None

    if ensure_network:
        _ensure_runtime_on_network(runtime)
    network = _runtime_docker_network(allow_docker_probe=False)
    if network:
        return f"http://{_container_name(runtime)}:{port}"
    return None


def runtime_api_server_base_url(runtime: RuntimeInstance, *, ensure_network: bool = False) -> str | None:
    """Private URL the API uses to reach the runtime OpenAI-compatible listener."""
    manager = (runtime.manager or os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()
    port = runtime_api_server_container_port()
    if manager in {"k8s", "kubernetes"}:
        dashboard = runtime.dashboard_url or ""
        if dashboard:
            from urllib.parse import urlparse, urlunparse

            parsed = urlparse(dashboard)
            host = parsed.hostname or ""
            if host and parsed.port == 9119:
                netloc = f"{host}:{port}"
                return urlunparse(parsed._replace(netloc=netloc))
        return None

    if ensure_network:
        _ensure_runtime_on_network(runtime)
    network = _runtime_docker_network(allow_docker_probe=False)
    if network:
        return f"http://{_container_name(runtime)}:{port}"
    return None


def runtime_dashboard_base_url(runtime: RuntimeInstance, *, ensure_network: bool = False) -> str | None:
    """URL the API should use to reach Hermes.

    Prefer the shared Docker Compose network (container DNS name :9119). That
    path works for both HTTP and WebSockets. Host-published ports
    (``172.17.0.1:19119``) go through docker-proxy and often hang WS upgrades;
    default-bridge IPs are often unreachable from the compose network.

    For K8s/Fly backends there is no compose DNS name — use ``dashboard_url``.

    ``ensure_network`` is for start/WS paths only — never on status polling.
    """
    manager = (runtime.manager or os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()
    if manager in {"k8s", "kubernetes"}:
        return runtime.dashboard_url

    if ensure_network:
        _ensure_runtime_on_network(runtime)
    # Hot path: env/cache only. Never docker-inspect here.
    network = _runtime_docker_network(allow_docker_probe=False)
    if network:
        # DNS on the compose network is enough for HTTP+WS; skip IP inspect on
        # the hot path so status polls stay non-blocking.
        return f"http://{_container_name(runtime)}:9119"

    return runtime.dashboard_url


def runtime_dashboard_ws_candidates(runtime: RuntimeInstance) -> list[str]:
    """Compose-DNS only for local-docker. K8s/Fly use dashboard_url.

    IP inspect + network connect used to wedge docker.sock (and the API worker)
    right when the browser opened the gateway socket.
    """
    manager = (runtime.manager or os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker").strip().lower()
    if manager in {"k8s", "kubernetes"}:
        return [runtime.dashboard_url] if runtime.dashboard_url else []

    candidates: list[str] = []
    # Env/cache only — no allow_docker_probe on the WS hot path.
    network = _runtime_docker_network(allow_docker_probe=False)
    if network:
        candidates.append(f"http://{_container_name(runtime)}:9119")
        return candidates

    preferred = runtime_dashboard_base_url(runtime, ensure_network=False)
    if preferred:
        candidates.append(preferred)
    return candidates


def _docker_mount_path(path: str) -> str:
    docker_root = os.getenv("VERXIO_RUNTIME_DOCKER_ROOT", "").strip()
    if not docker_root:
        return path

    resolved = Path(path).expanduser().resolve()
    runtime_root_env = os.getenv("VERXIO_RUNTIME_ROOT", "").strip()
    runtime_root = Path(runtime_root_env).expanduser().resolve() if runtime_root_env else resolved.parents[2]
    try:
        relative = resolved.relative_to(runtime_root)
    except ValueError:
        return path

    return str(Path(docker_root).expanduser() / relative)


async def runtime_health(runtime: RuntimeInstance) -> tuple[bool, str]:
    if runtime.status == "running" and runtime_recently_healthy(runtime):
        return True, "Verxio runtime was reachable recently."

    candidates: list[str] = []
    preferred = runtime_dashboard_base_url(runtime, ensure_network=False)
    if preferred:
        candidates.append(preferred)
    # Only hairpin to the published host port when we have no compose-network URL.
    # docker-proxy to 127.0.0.1/host.docker.internal often hangs from inside the API.
    if not preferred and runtime.dashboard_url and runtime.dashboard_url not in candidates:
        candidates.append(runtime.dashboard_url)
    if not candidates:
        return False, "Runtime has no dashboard URL yet."

    errors: list[str] = []
    # Keep this short — status polling must not pile up 5s+ waits per request.
    async with httpx.AsyncClient(timeout=_runtime_health_timeout_seconds()) as client:
        for base in candidates:
            try:
                response = await client.get(f"{base.rstrip('/')}/api/status")
                response.raise_for_status()
                try:
                    payload = normalize_gateway_status_payload(response.json())
                except Exception:
                    payload = None
                if isinstance(payload, dict) and payload.get("gateway_running") is False:
                    state = payload.get("gateway_state") or "not running"
                    raise RuntimeError(f"runtime dashboard is reachable but gateway is {state}")
                mark_runtime_healthy(runtime)
                return True, "Verxio runtime is reachable."
            except Exception as exc:
                errors.append(f"{base}: {exc}")
    return False, f"Verxio runtime is not reachable: {'; '.join(errors)}"


def _runtime_health_timeout_seconds() -> float:
    raw = os.getenv("VERXIO_RUNTIME_HEALTH_TIMEOUT_SECONDS", "3").strip()
    try:
        return max(1.0, float(raw))
    except ValueError:
        return 3.0


def _runtime_ready_timeout_seconds() -> float:
    raw = os.getenv("VERXIO_RUNTIME_READY_TIMEOUT_SECONDS", "90").strip()
    try:
        return max(5.0, float(raw))
    except ValueError:
        return 90.0


async def wait_for_runtime_ready(
    runtime: RuntimeInstance,
    *,
    timeout_seconds: float | None = None,
) -> RuntimeInstance:
    """Block until the Verxio runtime answers, or the timeout elapses."""
    deadline = asyncio.get_running_loop().time() + (
        _runtime_ready_timeout_seconds() if timeout_seconds is None else max(1.0, timeout_seconds)
    )
    latest = runtime
    detail = "Verxio runtime is not reachable yet."

    while asyncio.get_running_loop().time() < deadline:
        connected, detail = await runtime_health(latest)
        if connected:
            return save_runtime(
                latest,
                status="running",
                last_seen_at=now_iso(),
                last_error=None,
            )
        await asyncio.sleep(1.0)

    return save_runtime(
        latest,
        status="starting",
        last_error=detail,
    )


def _start_lock_for(runtime: RuntimeInstance) -> asyncio.Lock:
    name = _container_name(runtime)
    lock = _START_LOCKS.get(name)
    if lock is None:
        lock = asyncio.Lock()
        _START_LOCKS[name] = lock
    return lock


async def start_runtime(
    runtime: RuntimeInstance,
    extra_env: dict[str, str] | None = None,
    *,
    wait_ready: bool = True,
) -> RuntimeInstance:
    # mkdir/config seed can touch a cold volume — keep it off the event loop.
    # Also remaps hosted workspaces off stale desktop device paths before mount.
    runtime = await asyncio.to_thread(ensure_runtime_directories, runtime)

    async with _start_lock_for(runtime):
        return await _start_runtime_locked(runtime, extra_env=extra_env, wait_ready=wait_ready)


async def _start_runtime_locked(
    runtime: RuntimeInstance,
    extra_env: dict[str, str] | None = None,
    *,
    wait_ready: bool = True,
) -> RuntimeInstance:
    # Fast path for boot polling: skip docker + Hermes probes when we just
    # confirmed the dashboard is up. Prevents thundering-herd freezes on refresh.
    if not wait_ready and runtime.status == "running" and runtime_recently_healthy(runtime):
        if _runtime_docker_network(allow_docker_probe=False):
            await asyncio.to_thread(_ensure_runtime_on_network, runtime)
        return runtime

    current = await _run_docker_async(["inspect", "-f", "{{.State.Running}}", _container_name(runtime)])
    if current.returncode == 0 and current.stdout.strip() == "true":
        if _runtime_docker_network(allow_docker_probe=False):
            await asyncio.to_thread(_ensure_runtime_on_network, runtime)
        if not wait_ready and runtime_recently_healthy(runtime):
            return save_runtime(
                runtime,
                status="running",
                last_seen_at=now_iso(),
                last_error=None,
            )
        connected, detail = await runtime_health(runtime)
        if connected:
            return save_runtime(
                runtime,
                status="running",
                last_seen_at=now_iso(),
                last_error=None,
            )
        starting = save_runtime(
            runtime,
            status="starting",
            last_error=detail,
        )
        # Polling clients (dashboard proxy GETs) need a fast 503 so the browser
        # can retry. Blocking up to VERXIO_RUNTIME_READY_TIMEOUT_SECONDS here
        # races the web client's 30s AbortController ("signal is aborted…").
        if not wait_ready:
            return starting
        return await wait_for_runtime_ready(starting)

    if current.returncode == 0:
        await _run_docker_async(["rm", _container_name(runtime)])
        invalidate_runtime_caches(runtime)

    port = _dashboard_port_for_start(runtime)
    token_row = db.fetch_one("SELECT dashboard_token FROM runtime_instances WHERE id = ?", (runtime.id,))
    dashboard_token = str(token_row.get("dashboard_token") or "") if token_row else ""
    if not dashboard_token:
        dashboard_token = secrets.token_urlsafe(32)

    image = os.getenv("VERXIO_HERMES_IMAGE", runtime.image or "nousresearch/hermes-agent:latest")
    dashboard_url = f"http://{_runtime_connect_host()}:{port}"
    container_name = _container_name(runtime)

    cmd = [
        "run",
        "-d",
        "--name",
        container_name,
        "--restart",
        os.getenv("VERXIO_RUNTIME_RESTART_POLICY", "no").strip() or "no",
        "--label",
        f"com.docker.compose.project={os.getenv('COMPOSE_PROJECT_NAME', 'verxio-ai').strip() or 'verxio-ai'}",
        "--label",
        "com.docker.compose.service=hermes-runtime",
        "-v",
        f"{_docker_mount_path(runtime.hermes_home_path)}:/opt/data",
        "-v",
        f"{_docker_mount_path(runtime.workspace_path)}:/workspace",
    ]
    publish_ports = os.getenv("VERXIO_RUNTIME_PUBLISH_PORTS", "true").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }
    if publish_ports:
        cmd.extend(
            [
                "-p",
                f"{_runtime_publish_host()}:{port}:9119",
            ]
        )
    cmd.extend(
        [
        "-e",
        "HERMES_DASHBOARD=1",
        "-e",
        "HERMES_DASHBOARD_HOST=0.0.0.0",
        "-e",
        "HERMES_DASHBOARD_INSECURE=1",
        "-e",
        "HERMES_DASHBOARD_PORT=9119",
        "-e",
        f"HERMES_DASHBOARD_SESSION_TOKEN={dashboard_token}",
        # Same secret as the dashboard token — Hermes notepad/control-plane tools
        # send it as Authorization: Bearer to verxio-api.
        "-e",
        f"VERXIO_RUNTIME_TOKEN={dashboard_token}",
        "-e",
        "TERMINAL_CWD=/workspace",
        # Image default is /opt/data, but Verxio mounts the agent workspace at
        # /workspace. An empty safe root keeps credential denylists active while
        # allowing write_file under /workspace (and Hermes state under /opt/data).
        "-e",
        "HERMES_WRITE_SAFE_ROOT=",
        # Allow messaging gateway to attach files from the mounted workspace
        # when media delivery is in strict/allowlist mode.
        "-e",
        "HERMES_MEDIA_ALLOW_DIRS=/workspace",
        "-e",
        f"HERMES_UID={os.getenv('VERXIO_RUNTIME_UID', os.getenv('HERMES_UID', '10000'))}",
        "-e",
        f"HERMES_GID={os.getenv('VERXIO_RUNTIME_GID', os.getenv('HERMES_GID', '10000'))}",
        ]
    )
    # Cache/env only here — never sync-probe docker.sock on the event loop.
    network = _runtime_docker_network(allow_docker_probe=False)
    if not network:
        network = await warm_runtime_docker_network()
    if network:
        # Same network as verxio-api → DNS name works for HTTP and WebSocket.
        cmd.extend(["--network", network])
    container_env = _runtime_container_env(runtime, extra_env)
    composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
    if composio_api_key:
        container_env["COMPOSIO_API_KEY"] = composio_api_key
    for key, value in sorted(container_env.items()):
        cmd.extend(["-e", f"{key}={value}"])

    cmd.extend([image, "gateway", "run"])

    result = await _run_docker_async(cmd)
    if result.returncode != 0:
        return save_runtime(
            runtime,
            status="error",
            container_name=container_name,
            image=image,
            dashboard_url=dashboard_url,
            dashboard_token=dashboard_token,
            last_error=result.stderr.strip() or result.stdout.strip() or "Docker failed to start runtime.",
        )

    started = save_runtime(
        runtime,
        status="starting",
        container_id=result.stdout.strip(),
        container_name=container_name,
        image=image,
        dashboard_url=dashboard_url,
        dashboard_token=dashboard_token,
        last_started_at=now_iso(),
        last_error=None,
    )
    if not wait_ready:
        return started
    return await wait_for_runtime_ready(started)


def stop_runtime(runtime: RuntimeInstance) -> RuntimeInstance:
    name = _container_name(runtime)
    invalidate_runtime_caches(runtime)
    result = _run_docker(["stop", name])
    if result.returncode not in {0, 1}:
        return save_runtime(runtime, status="error", last_error=result.stderr.strip() or "Docker stop failed.")
    return save_runtime(runtime, status="stopped", last_error=None)


async def stop_runtime_async(runtime: RuntimeInstance) -> RuntimeInstance:
    return await asyncio.to_thread(stop_runtime, runtime)


async def restart_runtime(runtime: RuntimeInstance, extra_env: dict[str, str] | None = None) -> RuntimeInstance:
    stopped = await stop_runtime_async(runtime)
    return await start_runtime(stopped, extra_env=extra_env)


def _merge_workspace_tree(source: Path, destination: Path) -> None:
    if not source.exists():
        return

    for item in source.rglob("*"):
        if not item.is_file():
            continue

        relative = item.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)

        if not target.exists():
            import shutil

            shutil.copy2(item, target)


async def sync_runtime_workspace(runtime: RuntimeInstance, workspace_path: str) -> RuntimeInstance:
    """Point the runtime Docker mount at a host workspace folder (desktop sync).

    Desktop (macOS) binds the user's device folder (e.g. Documents/Verxio).
    Hosted/web keeps the managed RUNTIME_ROOT workspace and rejects device paths.
    """
    from app.control_plane import enforce_managed_workspace, ensure_hosted_workspace_paths

    if enforce_managed_workspace():
        # Ignore desktop device paths on hosted control planes (shared Turso can
        # otherwise leave ECS mounting /Users/.../Documents/Verxio).
        return await restart_runtime(ensure_hosted_workspace_paths(runtime))

    resolved = Path(workspace_path).expanduser().resolve()

    if not resolved.is_absolute():
        raise ValueError("workspace_path must be an absolute path.")

    artifact_path = resolved / "artifacts"
    for path in (resolved, artifact_path):
        path.mkdir(parents=True, exist_ok=True)

    previous_workspace = Path(runtime.workspace_path).expanduser().resolve()
    if previous_workspace != resolved:
        _merge_workspace_tree(previous_workspace, resolved)
        _merge_workspace_tree(previous_workspace / "artifacts", artifact_path)

    db.execute(
        """
        UPDATE runtime_instances
        SET workspace_path = ?, artifact_path = ?, updated_at = ?
        WHERE id = ?
        """,
        (str(resolved), str(artifact_path), now_iso(), runtime.id),
    )
    row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
    updated = runtime_from_row(row or {})

    return await restart_runtime(updated)


def _is_path_within(path: Path, root: Path) -> bool:
    return path == root or root in path.parents


def _managed_runtime_root() -> Path | None:
    runtime_root_env = os.getenv("VERXIO_RUNTIME_ROOT", "").strip()
    if not runtime_root_env:
        return None
    return Path(runtime_root_env).expanduser().resolve()


def _path_is_under_managed_runtime(path: Path) -> bool:
    root = _managed_runtime_root()
    if root is None:
        return True
    try:
        path.resolve().relative_to(root)
        return True
    except ValueError:
        return False


def _dir_has_files(path: Path) -> bool:
    if not path.exists() or not path.is_dir():
        return False
    return any(entry.is_file() for entry in path.rglob("*"))


def _sync_container_workspace_artifacts(runtime: RuntimeInstance) -> Path | None:
    """Mirror Hermes `/workspace/artifacts` into an API-visible directory.

    Desktop-synced workspaces use host paths (for example under Documents) that
    Hermes bind-mounts correctly, but the API container often cannot see.
    Without this sync, generated images land on disk and chat mentions
    `/workspace/artifacts/...`, yet Verxio indexes an empty ghost folder and
    shows "Not found in artifacts yet".
    """

    if runtime.mode != "local-docker":
        return None

    artifact_root = Path(runtime.artifact_path).expanduser().resolve()
    if _dir_has_files(artifact_root):
        return None

    container = _container_name(runtime)
    running = _run_docker(["inspect", "-f", "{{.State.Running}}", container])
    if running.returncode != 0 or running.stdout.strip() != "true":
        return None

    probe = _run_docker(
        [
            "exec",
            container,
            "sh",
            "-lc",
            "test -d /workspace/artifacts && find /workspace/artifacts -type f "
            "! -path '*/node_modules/*' ! -path '*/.git/*' ! -path '*/.next/*' ! -path '*/dist/*' "
            "| head -1 | grep -q .",
        ]
    )
    if probe.returncode != 0:
        return None

    # Never bulk-copy scaffolded app trees (node_modules/.next/dist) — that can
    # wedge the API host and leave /api/artifacts returning HTML error pages.
    heavy = _run_docker(
        [
            "exec",
            container,
            "sh",
            "-lc",
            "find /workspace/artifacts \\( -name node_modules -o -name .next -o -name dist -o -name build \\) "
            "-type d 2>/dev/null | head -1 | grep -q .",
        ]
    )
    if heavy.returncode == 0:
        return None

    mirror = (Path(runtime.hermes_home_path).expanduser().resolve() / "artifacts")
    mirror.mkdir(parents=True, exist_ok=True)
    copied = _run_docker(["cp", f"{container}:/workspace/artifacts/.", f"{mirror}/"])
    if copied.returncode != 0:
        return None
    return mirror


def _workspace_artifact_candidates(runtime: RuntimeInstance) -> list[tuple[Path, str, str]]:
    """Return host files that should appear in the user-facing Artifacts view.

    The primary contract is `/workspace/artifacts/*`, but generated files often
    land at `/workspace/report.csv` or `/workspace/reports/chart.png`. Keep this
    intentionally narrow so ordinary project source files do not flood Artifacts.

    Some runtime delivery paths also save generated files under
    `$HERMES_HOME/artifacts`. Index those as runtime-home artifacts so files that
    the chat can deliver are still visible in Verxio's Artifacts page.
    """

    _sync_container_workspace_artifacts(runtime)

    artifact_root = Path(runtime.artifact_path).resolve()
    workspace_root = Path(runtime.workspace_path).resolve()
    runtime_home_artifact_root = (Path(runtime.hermes_home_path) / "artifacts").resolve()
    candidates: list[tuple[Path, str, str]] = []

    if artifact_root.exists():
        for file_path in _iter_files_skipping_dirs(artifact_root):
            if not file_path.is_file():
                continue
            try:
                relative = file_path.relative_to(artifact_root)
            except ValueError:
                continue
            resolved = file_path.resolve()
            if not _is_path_within(resolved, artifact_root):
                continue
            candidates.append((resolved, relative.as_posix(), "workspace"))
            if len(candidates) >= _MAX_INDEXED_ARTIFACT_FILES:
                return candidates

    if workspace_root.exists():
        for file_path in workspace_root.iterdir():
            if not file_path.is_file() or file_path.suffix.lower() not in _ARTIFACT_FILE_EXTENSIONS:
                continue
            resolved = file_path.resolve()
            if not _is_path_within(resolved, workspace_root):
                continue
            candidates.append(
                (resolved, f"workspace/{resolved.relative_to(workspace_root).as_posix()}", "workspace_root")
            )
            if len(candidates) >= _MAX_INDEXED_ARTIFACT_FILES:
                return candidates

        for folder_name in sorted(_WORKSPACE_ARTIFACT_DIR_NAMES - {"artifacts"}):
            folder = workspace_root / folder_name
            if not folder.is_dir():
                continue
            for file_path in _iter_files_skipping_dirs(folder):
                if not file_path.is_file() or file_path.suffix.lower() not in _ARTIFACT_FILE_EXTENSIONS:
                    continue
                resolved = file_path.resolve()
                if not _is_path_within(resolved, workspace_root):
                    continue
                candidates.append(
                    (resolved, f"workspace/{resolved.relative_to(workspace_root).as_posix()}", "workspace_root")
                )
                if len(candidates) >= _MAX_INDEXED_ARTIFACT_FILES:
                    return candidates

    if runtime_home_artifact_root.exists():
        for file_path in _iter_files_skipping_dirs(runtime_home_artifact_root):
            if not file_path.is_file() or file_path.suffix.lower() not in _ARTIFACT_FILE_EXTENSIONS:
                continue
            try:
                relative_path = file_path.relative_to(runtime_home_artifact_root)
            except ValueError:
                continue
            resolved = file_path.resolve()
            if not _is_path_within(resolved, runtime_home_artifact_root):
                continue
            relative = relative_path.as_posix()
            candidates.append((resolved, f"{_RUNTIME_HOME_ARTIFACT_PREFIX}{relative}", "runtime_home"))
            if len(candidates) >= _MAX_INDEXED_ARTIFACT_FILES:
                return candidates

    return candidates


def _cleanup_missing_artifacts(runtime: RuntimeInstance, allowed_roots: list[Path]) -> None:
    rows = db.fetch_all(
        """
        SELECT id, absolute_path
        FROM artifacts
        WHERE workspace_id = ? AND agent_id = ?
        """,
        (runtime.workspace_id, runtime.agent_id),
    )

    for row in rows:
        file_path = Path(str(row["absolute_path"])).resolve()
        if (
            file_path.exists()
            and file_path.is_file()
            and any(_is_path_within(file_path, root) for root in allowed_roots)
        ):
            continue
        db.execute("DELETE FROM artifacts WHERE id = ?", (row["id"],))


def index_artifacts(runtime: RuntimeInstance) -> list[ArtifactRecord]:
    artifact_root = Path(runtime.artifact_path).resolve()
    workspace_root = Path(runtime.workspace_path).resolve()
    runtime_home_artifact_root = (Path(runtime.hermes_home_path) / "artifacts").resolve()
    # Only auto-create artifact dirs under the managed runtime root. Creating
    # `/Users/.../Documents/...` inside the API container when that host path
    # is not bind-mounted leaves an empty ghost directory that hides real files.
    if _path_is_under_managed_runtime(artifact_root):
        artifact_root.mkdir(parents=True, exist_ok=True)

    for resolved, relative, source in _workspace_artifact_candidates(runtime):
        stat = resolved.stat()
        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        # Use file mtime — stamping updated_at=now on every index made every
        # artifact look like it was created "today" and scrambled sort order.
        mtime_iso = _file_mtime_iso(stat)
        existing = db.fetch_one(
            """
            SELECT id, size_bytes, sha256, absolute_path, content_type, source, updated_at
            FROM artifacts
            WHERE workspace_id = ? AND agent_id = ? AND relative_path = ?
            """,
            (runtime.workspace_id, runtime.agent_id, relative),
        )
        if existing:
            # Skip re-hashing / rewriting unchanged files — full SHA + UPDATE of
            # hundreds of images was regularly aborting the web client's 60s
            # artifacts timeout and also restamped every row with wall-clock "now".
            unchanged = (
                int(existing.get("size_bytes") or 0) == stat.st_size
                and str(existing.get("absolute_path") or "") == str(resolved)
                and str(existing.get("content_type") or "") == content_type
                and str(existing.get("source") or "") == source
                and str(existing.get("updated_at") or "") == mtime_iso
                and existing.get("sha256")
            )
            if unchanged:
                continue
            if int(existing.get("size_bytes") or 0) == stat.st_size and existing.get("sha256"):
                digest = str(existing["sha256"])
            else:
                digest = _sha256_file(resolved)
            db.execute(
                """
                UPDATE artifacts
                SET file_name = ?, absolute_path = ?, content_type = ?, size_bytes = ?, sha256 = ?, source = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    resolved.name,
                    str(resolved),
                    content_type,
                    stat.st_size,
                    digest,
                    source,
                    mtime_iso,
                    existing["id"],
                ),
            )
        else:
            db.execute(
                """
                INSERT INTO artifacts (
                    id, tenant_id, workspace_id, agent_id, file_name, relative_path, absolute_path,
                    content_type, size_bytes, sha256, source, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    new_id("art"),
                    runtime.tenant_id,
                    runtime.workspace_id,
                    runtime.agent_id,
                    resolved.name,
                    relative,
                    str(resolved),
                    content_type,
                    stat.st_size,
                    _sha256_file(resolved),
                    source,
                    mtime_iso,
                    mtime_iso,
                ),
            )

    _cleanup_missing_artifacts(runtime, [artifact_root, workspace_root, runtime_home_artifact_root])

    rows = db.fetch_all(
        """
        SELECT id, tenant_id, workspace_id, agent_id, file_name, relative_path,
               content_type, size_bytes, source, sha256, created_at, updated_at
        FROM artifacts
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC, created_at DESC, file_name ASC
        """,
        (runtime.workspace_id, runtime.agent_id),
    )
    return [ArtifactRecord(**row) for row in _dedupe_artifact_rows(list(rows))]


def artifact_file(runtime: RuntimeInstance, artifact_id: str) -> tuple[ArtifactRecord, Path]:
    row = db.fetch_one(
        """
        SELECT id, tenant_id, workspace_id, agent_id, file_name, relative_path,
               absolute_path, content_type, size_bytes, source, created_at, updated_at
        FROM artifacts
        WHERE id = ? AND workspace_id = ? AND agent_id = ?
        """,
        (artifact_id, runtime.workspace_id, runtime.agent_id),
    )
    if not row:
        raise KeyError("Artifact not found.")

    artifact_root = Path(runtime.artifact_path).resolve()
    workspace_root = Path(runtime.workspace_path).resolve()
    runtime_home_artifact_root = (Path(runtime.hermes_home_path) / "artifacts").resolve()
    file_path = Path(str(row["absolute_path"])).resolve()
    if not any(
        _is_path_within(file_path, root)
        for root in (artifact_root, workspace_root, runtime_home_artifact_root)
    ):
        raise KeyError("Artifact path is outside the runtime workspace.")
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(str(file_path))

    public = {key: value for key, value in row.items() if key != "absolute_path"}
    return ArtifactRecord(**public), file_path
