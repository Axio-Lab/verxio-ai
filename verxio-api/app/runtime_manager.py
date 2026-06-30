from __future__ import annotations

import mimetypes
import os
import secrets
import socket
import subprocess
from pathlib import Path
from urllib.parse import urlparse

import httpx

from app import db
from app.control_plane import ensure_runtime_directories, now_iso, runtime_from_row, safe_path_part, save_runtime
from app.models import ArtifactRecord, RuntimeInstance, new_id


def _sha256_file(path: Path) -> str:
    import hashlib

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _docker_binary() -> str:
    return os.getenv("VERXIO_DOCKER_BIN", "docker")


def _run_docker(args: list[str]) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [_docker_binary(), *args],
        check=False,
        capture_output=True,
        text=True,
    )


def _container_name(runtime: RuntimeInstance) -> str:
    if runtime.container_name:
        return runtime.container_name
    return f"verxio-{safe_path_part(runtime.workspace_id)}-{safe_path_part(runtime.agent_id)}"


def runtime_container_env_matches(runtime: RuntimeInstance, key: str, expected_value: str) -> bool:
    """Return True when the running runtime container has the expected env value."""

    if not key or not expected_value:
        return False

    result = _run_docker(
        [
            "inspect",
            "-f",
            "{{range .Config.Env}}{{println .}}{{end}}",
            _container_name(runtime),
        ]
    )
    if result.returncode != 0:
        return False

    prefix = f"{key}="
    for line in result.stdout.splitlines():
        if line.startswith(prefix):
            return line[len(prefix) :] == expected_value

    return False


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
    if not runtime.dashboard_url:
        return False, "Runtime has no dashboard URL yet."
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            response = await client.get(f"{runtime.dashboard_url}/api/status")
            response.raise_for_status()
        return True, "Hermes dashboard is reachable."
    except Exception as exc:
        return False, f"Hermes dashboard is not reachable: {exc}"


async def start_runtime(runtime: RuntimeInstance, extra_env: dict[str, str] | None = None) -> RuntimeInstance:
    ensure_runtime_directories(runtime)

    current = _run_docker(["inspect", "-f", "{{.State.Running}}", _container_name(runtime)])
    if current.returncode == 0 and current.stdout.strip() == "true":
        connected, detail = await runtime_health(runtime)
        return save_runtime(
            runtime,
            status="running" if connected else "starting",
            last_seen_at=now_iso() if connected else runtime.last_seen_at,
            last_error=None if connected else detail,
        )

    if current.returncode == 0:
        _run_docker(["rm", _container_name(runtime)])

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
    composio_api_key = os.getenv("COMPOSIO_API_KEY", "").strip()
    if composio_api_key:
        cmd.extend(["-e", f"COMPOSIO_API_KEY={composio_api_key}"])
    for key, value in sorted((extra_env or {}).items()):
        if key and value:
            cmd.extend(["-e", f"{key}={value}"])

    cmd.extend([image, "gateway", "run"])

    result = _run_docker(cmd)
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

    return save_runtime(
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


def stop_runtime(runtime: RuntimeInstance) -> RuntimeInstance:
    name = _container_name(runtime)
    result = _run_docker(["stop", name])
    if result.returncode not in {0, 1}:
        return save_runtime(runtime, status="error", last_error=result.stderr.strip() or "Docker stop failed.")
    return save_runtime(runtime, status="stopped", last_error=None)


async def restart_runtime(runtime: RuntimeInstance, extra_env: dict[str, str] | None = None) -> RuntimeInstance:
    stopped = stop_runtime(runtime)
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
