from __future__ import annotations

import json
import os
import re
import sys
import time
from collections import OrderedDict
from pathlib import Path
from typing import Any

from app import db
from app.models import AgentProfile, RuntimeInstance, Workspace, new_id, utc_now
from app.verxio_agent_defaults import VERXIO_SOUL_MD, ensure_verxio_agent_defaults


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
VERXIO_STATE_DIR = WORKSPACE_ROOT / ".verxio"
RUNTIME_ROOT = Path(os.getenv("VERXIO_RUNTIME_ROOT", str(VERXIO_STATE_DIR / "runtimes"))).expanduser()

DEFAULT_CAPABILITIES = [
    "Use the model and provider configured in Verxio",
    "Run connected tools, skills, apps, and messaging channels through the Verxio runtime",
    "Keep user-agent memory inside the isolated Verxio workspace",
    "Write generated files to the workspace artifacts directory",
]

DEFAULT_STARTERS = [
    "Help me understand this workspace and decide what to build next.",
    "Create a useful report and save it as a Verxio artifact.",
    "Inspect the runtime setup and tell me what is ready.",
]
CONTEXT_CACHE_TTL_SECONDS = max(0, int(os.getenv("VERXIO_CONTEXT_CACHE_TTL_SECONDS", "30")))
CONTEXT_CACHE_MAX_ENTRIES = max(16, int(os.getenv("VERXIO_CONTEXT_CACHE_MAX_ENTRIES", "4096")))
_CONTEXT_CACHE: OrderedDict[str, tuple[Workspace, AgentProfile, RuntimeInstance, float]] = OrderedDict()


def now_iso() -> str:
    return utc_now().isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:64] or "workspace"


def safe_path_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("._") or "item"


def _cache_context(user_id: str, workspace: Workspace, agent: AgentProfile, runtime: RuntimeInstance) -> None:
    if CONTEXT_CACHE_TTL_SECONDS <= 0:
        return

    _CONTEXT_CACHE[user_id] = (workspace, agent, runtime, time.monotonic() + CONTEXT_CACHE_TTL_SECONDS)
    _CONTEXT_CACHE.move_to_end(user_id)

    while len(_CONTEXT_CACHE) > CONTEXT_CACHE_MAX_ENTRIES:
        _CONTEXT_CACHE.popitem(last=False)


def _cached_context(user_id: str) -> tuple[Workspace, AgentProfile, RuntimeInstance] | None:
    cached = _CONTEXT_CACHE.get(user_id)
    if not cached:
        return None

    workspace, agent, runtime, cached_until = cached
    if cached_until <= time.monotonic():
        _CONTEXT_CACHE.pop(user_id, None)
        return None

    _CONTEXT_CACHE.move_to_end(user_id)
    return workspace, agent, runtime


def _invalidate_context_cache(*, workspace_id: str | None = None, agent_id: str | None = None) -> None:
    if not _CONTEXT_CACHE:
        return

    if workspace_id is None and agent_id is None:
        _CONTEXT_CACHE.clear()
        return

    stale = [
        user_id
        for user_id, (workspace, agent, _runtime, _cached_until) in _CONTEXT_CACHE.items()
        if (workspace_id and workspace.id == workspace_id) or (agent_id and agent.id == agent_id)
    ]

    for user_id in stale:
        _CONTEXT_CACHE.pop(user_id, None)


def runtime_base_path(workspace_id: str, agent_id: str) -> Path:
    return RUNTIME_ROOT / safe_path_part(workspace_id) / safe_path_part(agent_id)


def runtime_paths(workspace_id: str, agent_id: str) -> dict[str, str]:
    base = runtime_base_path(workspace_id, agent_id)
    return {
        "hermes_home_path": str(base / "hermes-home"),
        "workspace_path": str(base / "workspace"),
        "artifact_path": str(base / "workspace" / "artifacts"),
    }


def _runtime_fs_ids() -> tuple[int, int]:
    uid = int(os.getenv("VERXIO_RUNTIME_UID", os.getenv("HERMES_UID", "10000")))
    gid = int(os.getenv("VERXIO_RUNTIME_GID", os.getenv("HERMES_GID", "10000")))
    return uid, gid


def _chown_path(path: Path, uid: int, gid: int) -> None:
    try:
        os.chown(path, uid, gid)
    except OSError:
        pass


def _chown_tree(path: Path, uid: int, gid: int) -> None:
    """Best-effort ownership fix so the hermes UID can write bind mounts on Linux."""
    _chown_path(path, uid, gid)
    try:
        for child in path.rglob("*"):
            _chown_path(child, uid, gid)
    except OSError:
        pass


def _is_under_runtime_root(path: Path) -> bool:
    """True only for Verxio-managed runtime storage — never desktop user folders."""
    try:
        path.expanduser().resolve().relative_to(RUNTIME_ROOT.expanduser().resolve())
        return True
    except (OSError, ValueError):
        return False


def _should_chown_workspace(path: Path) -> bool:
    """Chown workspace for Hermes writes, but never a real desktop user folder.

    - Always chown paths under RUNTIME_ROOT (hosted/managed).
    - On macOS desktop, never chown outside RUNTIME_ROOT (Documents/Verxio, etc.).
    - On Linux hosted, also chown stale absolute binds (e.g. leftover Mac
      `/Users/.../Documents/Verxio` created as root on ECS) so Hermes can write.
    """
    if _is_under_runtime_root(path):
        return True
    if os.name == "nt" or sys.platform == "darwin":
        return False
    return True


def enforce_managed_workspace() -> bool:
    """Hosted/web keeps workspaces under RUNTIME_ROOT; desktop may use the device folder.

    Desktop (macOS) calls ``/api/runtime/workspace`` to bind Documents/Verxio.
    Hosted Linux must ignore those absolute device paths (they poison shared DBs
    and mount as empty root-owned dirs on ECS).
    """
    flag = os.getenv("VERXIO_ALLOW_EXTERNAL_WORKSPACE", "").strip().lower()
    if flag in {"1", "true", "yes", "on"}:
        return False
    if sys.platform == "darwin":
        return False
    return True


def _merge_workspace_files(source: Path, destination: Path) -> None:
    if not source.exists() or not source.is_dir():
        return
    destination.mkdir(parents=True, exist_ok=True)
    for item in source.iterdir():
        target = destination / item.name
        try:
            if item.is_dir():
                _merge_workspace_files(item, target)
            elif item.is_file() and not target.exists():
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(item.read_bytes())
        except OSError:
            continue


def ensure_hosted_workspace_paths(runtime: RuntimeInstance) -> RuntimeInstance:
    """Remap stale desktop/device workspace paths back to managed RUNTIME_ROOT."""
    if not enforce_managed_workspace():
        return runtime

    workspace = Path(runtime.workspace_path).expanduser()
    if _is_under_runtime_root(workspace):
        return runtime

    paths = runtime_paths(runtime.workspace_id, runtime.agent_id)
    managed_workspace = Path(paths["workspace_path"])
    managed_artifacts = Path(paths["artifact_path"])
    managed_workspace.mkdir(parents=True, exist_ok=True)
    managed_artifacts.mkdir(parents=True, exist_ok=True)

    _merge_workspace_files(workspace, managed_workspace)
    _merge_workspace_files(workspace / "artifacts", managed_artifacts)

    db.execute(
        """
        UPDATE runtime_instances
        SET workspace_path = ?, artifact_path = ?, updated_at = ?
        WHERE id = ?
        """,
        (str(managed_workspace), str(managed_artifacts), now_iso(), runtime.id),
    )
    db.execute(
        """
        UPDATE agents
        SET workspace_path = ?, artifact_path = ?, updated_at = ?
        WHERE id = ?
        """,
        (str(managed_workspace), str(managed_artifacts), now_iso(), runtime.agent_id),
    )
    _invalidate_context_cache(workspace_id=runtime.workspace_id, agent_id=runtime.agent_id)
    row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
    return runtime_from_row(row or {}) if row else runtime.model_copy(
        update={
            "workspace_path": str(managed_workspace),
            "artifact_path": str(managed_artifacts),
        }
    )


def ensure_runtime_directories(runtime: RuntimeInstance) -> RuntimeInstance:
    runtime = ensure_hosted_workspace_paths(runtime)
    hermes_home = Path(runtime.hermes_home_path)
    workspace = Path(runtime.workspace_path)
    artifacts = Path(runtime.artifact_path)
    uid, gid = _runtime_fs_ids()

    for path in (hermes_home, workspace, artifacts):
        path.mkdir(parents=True, exist_ok=True)

    # Hosted/ECS: API mkdir as root, Hermes runs as UID 10000 — chown so
    # /workspace is writable. Desktop macOS: only touch RUNTIME_ROOT paths.
    if _is_under_runtime_root(hermes_home):
        _chown_path(hermes_home, uid, gid)
    if _should_chown_workspace(workspace):
        _chown_tree(workspace, uid, gid)

    config_path = hermes_home / "config.yaml"
    default_config = "\n".join(
        [
            "terminal:",
            "  backend: local",
            "  cwd: /workspace",
            "",
        ]
    )
    if not config_path.exists():
        config_path.write_text(default_config, encoding="utf-8")
    else:
        legacy_config = "\n".join(
            [
                "terminal:",
                "  backend: local",
                "  cwd: /workspace",
                "",
                "memory:",
                "  provider: null",
                "",
            ]
        )
        if config_path.read_text(encoding="utf-8") == legacy_config:
            config_path.write_text(default_config, encoding="utf-8")

    soul_path = hermes_home / "SOUL.md"
    if not soul_path.exists():
        soul_path.write_text(VERXIO_SOUL_MD, encoding="utf-8")

    ensure_verxio_agent_defaults(hermes_home)
    return runtime


def workspace_from_row(row: dict[str, Any]) -> Workspace:
    return Workspace(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        name=str(row["name"]),
        slug=str(row["slug"]),
        kind=str(row["kind"]),
        region="Hosted",
        plan="Verxio runtime workspace",
    )


def agent_from_row(row: dict[str, Any]) -> AgentProfile:
    raw_status = str(row.get("status") or "active")
    if raw_status not in {"active", "setup_required", "offline"}:
        raw_status = "active"
    role = str(row["role"])
    if role == "Hermes-powered assistant":
        role = "Verxio assistant"
    description = str(row["description"])
    description = description.replace(
        "A Verxio interface over an isolated Hermes Agent runtime.",
        "A Verxio AI agent with an isolated workspace and connected tools.",
    )
    return AgentProfile(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        workspace_id=str(row["workspace_id"]),
        name=str(row["name"]),
        role=role,
        status=raw_status,  # type: ignore[arg-type]
        description=description,
        capabilities=DEFAULT_CAPABILITIES,
        starters=DEFAULT_STARTERS,
    )


def runtime_from_row(row: dict[str, Any]) -> RuntimeInstance:
    return RuntimeInstance(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        workspace_id=str(row["workspace_id"]),
        agent_id=str(row["agent_id"]),
        mode=str(row["mode"]),
        status=str(row["status"]),
        container_id=row.get("container_id"),
        container_name=row.get("container_name"),
        image=row.get("image"),
        dashboard_url=row.get("dashboard_url"),
        hermes_home_path=str(row["hermes_home_path"]),
        workspace_path=str(row["workspace_path"]),
        artifact_path=str(row["artifact_path"]),
        last_started_at=row.get("last_started_at"),
        last_seen_at=row.get("last_seen_at"),
        last_error=row.get("last_error"),
        last_activity_at=row.get("last_activity_at"),
        idle_policy=str(row.get("idle_policy") or "default"),
        cell_id=str(row.get("cell_id") or "cell_default"),
        manager=row.get("manager"),
        external_ref=row.get("external_ref"),
    )


def ensure_personal_workspace(
    user: dict[str, Any], *, use_cache: bool = True
) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
    cached = _cached_context(str(user["id"])) if use_cache else None
    if cached:
        return cached

    existing = db.fetch_one(
        """
        SELECT w.* FROM workspaces w
        JOIN workspace_members wm ON wm.workspace_id = w.id
        WHERE wm.user_id = ?
        ORDER BY w.created_at ASC
        LIMIT 1
        """,
        (user["id"],),
    )
    if existing:
        workspace = workspace_from_row(existing)
    else:
        created_at = now_iso()
        workspace_id = new_id("ws")
        tenant_id = str(user["id"])
        workspace_name = f"{user['name']}'s workspace"
        with db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO workspaces (id, tenant_id, name, slug, kind, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'personal', ?, ?, ?)
                """,
                (workspace_id, tenant_id, workspace_name, slugify(workspace_name), user["id"], created_at, created_at),
            )
            conn.execute(
                """
                INSERT INTO workspace_members (workspace_id, user_id, role, created_at)
                VALUES (?, ?, 'owner', ?)
                """,
                (workspace_id, user["id"], created_at),
            )
        workspace = workspace_from_row(db.fetch_one("SELECT * FROM workspaces WHERE id = ?", (workspace_id,)) or {})

    agent_row = db.fetch_one(
        "SELECT * FROM agents WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1",
        (workspace.id,),
    )
    if not agent_row:
        created_at = now_iso()
        agent_id = new_id("agent")
        paths = runtime_paths(workspace.id, agent_id)
        with db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO agents (
                    id, tenant_id, workspace_id, name, role, status, description,
                    hermes_home_path, workspace_path, artifact_path, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?)
                """,
                (
                    agent_id,
                    workspace.tenant_id,
                    workspace.id,
                    "Verxio Agent",
                    "Verxio assistant",
                    "A Verxio AI agent with an isolated workspace and connected tools.",
                    paths["hermes_home_path"],
                    paths["workspace_path"],
                    paths["artifact_path"],
                    created_at,
                    created_at,
                ),
            )
        agent_row = db.fetch_one("SELECT * FROM agents WHERE id = ?", (agent_id,))

    agent = agent_from_row(agent_row or {})
    runtime = ensure_runtime_instance(workspace, agent)
    _cache_context(str(user["id"]), workspace, agent, runtime)
    return workspace, agent, runtime


def ensure_runtime_instance(workspace: Workspace, agent: AgentProfile) -> RuntimeInstance:
    from app.runtime_orch.cells import cell_for_tenant

    row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (workspace.id, agent.id),
    )
    if not row:
        created_at = now_iso()
        paths = runtime_paths(workspace.id, agent.id)
        runtime_id = new_id("rt")
        manager = os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker")
        cell = cell_for_tenant(workspace.tenant_id)
        with db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO runtime_instances (
                    id, tenant_id, workspace_id, agent_id, mode, status, image,
                    hermes_home_path, workspace_path, artifact_path, created_at, updated_at,
                    idle_policy, cell_id, manager
                )
                VALUES (?, ?, ?, ?, ?, 'stopped', ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    runtime_id,
                    workspace.tenant_id,
                    workspace.id,
                    agent.id,
                    manager,
                    os.getenv("VERXIO_HERMES_IMAGE", "nousresearch/hermes-agent:latest"),
                    paths["hermes_home_path"],
                    paths["workspace_path"],
                    paths["artifact_path"],
                    created_at,
                    created_at,
                    os.getenv("VERXIO_RUNTIME_IDLE_POLICY", "default"),
                    cell.id,
                    manager,
                ),
            )
        row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime_id,))
        _invalidate_context_cache(workspace_id=workspace.id, agent_id=agent.id)
    return runtime_from_row(row or {})


def get_context_for_user(user: dict[str, Any], *, fresh: bool = False) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
    return ensure_personal_workspace(user, use_cache=not fresh)


def get_runtime_for_user(
    user: dict[str, Any], agent_id: str | None = None, *, fresh: bool = False
) -> RuntimeInstance:
    workspace, agent, runtime = get_context_for_user(user, fresh=fresh)
    if agent_id and agent_id != agent.id:
        raise KeyError("Agent not found in active workspace.")
    return runtime


def save_runtime(runtime: RuntimeInstance, **patch: Any) -> RuntimeInstance:
    allowed = {
        "status",
        "container_id",
        "container_name",
        "image",
        "dashboard_url",
        "dashboard_token",
        "last_started_at",
        "last_seen_at",
        "last_error",
        "last_activity_at",
        "idle_policy",
        "cell_id",
        "manager",
        "external_ref",
    }
    fields = {key: value for key, value in patch.items() if key in allowed}
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    db.execute(
        f"UPDATE runtime_instances SET {assignments} WHERE id = ?",
        (*fields.values(), runtime.id),
    )
    row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
    updated = runtime_from_row(row or {})
    _invalidate_context_cache(workspace_id=updated.workspace_id, agent_id=updated.agent_id)
    return updated


def record_audit(
    *,
    tenant_id: str,
    actor: str,
    action: str,
    summary: str,
    status: str,
    workspace_id: str | None = None,
    agent_id: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> None:
    db.execute(
        """
        INSERT INTO audit_events (
            id, tenant_id, workspace_id, agent_id, actor, action, summary, status, metadata_json, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            new_id("evt"),
            tenant_id,
            workspace_id,
            agent_id,
            actor,
            action,
            summary,
            status,
            json.dumps(metadata or {}),
            now_iso(),
        ),
    )
