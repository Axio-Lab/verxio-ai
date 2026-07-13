from __future__ import annotations

import asyncio
import json
import mimetypes
import os
import secrets
import socket
import subprocess
import time
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
_HEALTHY_UNTIL: dict[str, float] = {}
_START_LOCKS: dict[str, asyncio.Lock] = {}
_CACHE_TTL_SECONDS = 60.0
_HEALTHY_TTL_SECONDS = 45.0
_OPTIONAL_UNPAIRED_PLATFORM_ERRORS = {
    "whatsapp": {"whatsapp_not_paired"},
}


def normalize_gateway_status_payload(payload: Any) -> Any:
    """Hide optional unpaired channel state from runtime health/status UI.

    A user can connect Slack without pairing WhatsApp. The gateway still reports
    WhatsApp as fatal when its platform config is present but no local pairing
    session exists; that should not make the hosted Verxio runtime look down.
    """

    if not isinstance(payload, dict):
        return payload

    platforms = payload.get("gateway_platforms")
    if not isinstance(platforms, dict):
        return payload

    normalized_platforms: dict[str, Any] = dict(platforms)
    changed = False

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

    if not changed:
        return payload

    normalized = dict(payload)
    normalized["gateway_platforms"] = normalized_platforms
    return normalized


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

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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
    _HEALTHY_UNTIL.pop(name, None)


def runtime_container_env_value(runtime: RuntimeInstance, key: str) -> str | None:
    """Return an env value from the running runtime container, if present."""

    if not key:
        return None

    result = _run_docker(
        [
            "inspect",
            "-f",
            "{{range .Config.Env}}{{println .}}{{end}}",
            _container_name(runtime),
        ]
    )
    if result.returncode != 0:
        return None

    prefix = f"{key}="
    for line in result.stdout.splitlines():
        if line.startswith(prefix):
            return line[len(prefix) :]
    return None


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


def _allocate_port() -> int:
    start = int(os.getenv("VERXIO_DASHBOARD_PORT_START", "19119"))
    for port in range(start, start + 1000):
        if _port_is_free(port):
            return port
    raise RuntimeError("No free localhost dashboard port found for a Verxio runtime.")


def _dashboard_port(runtime: RuntimeInstance) -> int:
    if runtime.dashboard_url:
        parsed = urlparse(runtime.dashboard_url)
        if parsed.port:
            return parsed.port
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


def runtime_dashboard_base_url(runtime: RuntimeInstance, *, ensure_network: bool = False) -> str | None:
    """URL the API should use to reach Hermes.

    Prefer the shared Docker Compose network (container DNS name :9119). That
    path works for both HTTP and WebSockets. Host-published ports
    (``172.17.0.1:19119``) go through docker-proxy and often hang WS upgrades;
    default-bridge IPs are often unreachable from the compose network.

    ``ensure_network`` is for start/WS paths only — never on status polling.
    """
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
    """Compose-DNS only. Never docker-inspect or docker-proxy on the WS path.

    IP inspect + network connect used to wedge docker.sock (and the API worker)
    right when the browser opened the gateway socket.
    """
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
    await asyncio.to_thread(ensure_runtime_directories, runtime)

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

    port = _dashboard_port(runtime)
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
        "unless-stopped",
        "-v",
        f"{_docker_mount_path(runtime.hermes_home_path)}:/opt/data",
        "-v",
        f"{_docker_mount_path(runtime.workspace_path)}:/workspace",
        "-p",
        f"{_runtime_publish_host()}:{port}:9119",
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
        "-e",
        "TERMINAL_CWD=/workspace",
        "-e",
        f"HERMES_UID={os.getenv('VERXIO_RUNTIME_UID', os.getenv('HERMES_UID', '10000'))}",
        "-e",
        f"HERMES_GID={os.getenv('VERXIO_RUNTIME_GID', os.getenv('HERMES_GID', '10000'))}",
    ]
    # Cache/env only here — never sync-probe docker.sock on the event loop.
    network = _runtime_docker_network(allow_docker_probe=False)
    if not network:
        network = await warm_runtime_docker_network()
    if network:
        # Same network as verxio-api → DNS name works for HTTP and WebSocket.
        cmd.extend(["--network", network])
    composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
    if composio_api_key:
        cmd.extend(["-e", f"COMPOSIO_API_KEY={composio_api_key}"])
    for key, value in {
        "VERXIO_HOSTED": "1",
        "WHATSAPP_BROWSER_NAME": "Verxio Agent",
        "WHATSAPP_REPLY_PREFIX": "",
    }.items():
        cmd.extend(["-e", f"{key}={value}"])
    for key, value in sorted((extra_env or {}).items()):
        if key and value:
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
    """Point the runtime Docker mount at a host workspace folder (desktop sync)."""
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


def index_artifacts(runtime: RuntimeInstance) -> list[ArtifactRecord]:
    artifact_root = Path(runtime.artifact_path).resolve()
    artifact_root.mkdir(parents=True, exist_ok=True)
    now = now_iso()

    for file_path in artifact_root.rglob("*"):
        if not file_path.is_file():
            continue
        resolved = file_path.resolve()
        if artifact_root not in resolved.parents and resolved != artifact_root:
            continue
        relative = resolved.relative_to(artifact_root).as_posix()
        stat = resolved.stat()
        content_type = mimetypes.guess_type(str(resolved))[0] or "application/octet-stream"
        existing = db.fetch_one(
            "SELECT id FROM artifacts WHERE workspace_id = ? AND agent_id = ? AND relative_path = ?",
            (runtime.workspace_id, runtime.agent_id, relative),
        )
        if existing:
            db.execute(
                """
                UPDATE artifacts
                SET file_name = ?, absolute_path = ?, content_type = ?, size_bytes = ?, sha256 = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    resolved.name,
                    str(resolved),
                    content_type,
                    stat.st_size,
                    _sha256_file(resolved),
                    now,
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'workspace', ?, ?)
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
                    now,
                    now,
                ),
            )

    rows = db.fetch_all(
        """
        SELECT id, tenant_id, workspace_id, agent_id, file_name, relative_path,
               content_type, size_bytes, source, created_at, updated_at
        FROM artifacts
        WHERE workspace_id = ? AND agent_id = ?
        ORDER BY updated_at DESC
        """,
        (runtime.workspace_id, runtime.agent_id),
    )
    return [ArtifactRecord(**row) for row in rows]


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
    file_path = Path(str(row["absolute_path"])).resolve()
    if artifact_root not in file_path.parents:
        raise KeyError("Artifact path is outside the runtime artifact directory.")
    if not file_path.exists() or not file_path.is_file():
        raise FileNotFoundError(str(file_path))

    public = {key: value for key, value in row.items() if key != "absolute_path"}
    return ArtifactRecord(**public), file_path
