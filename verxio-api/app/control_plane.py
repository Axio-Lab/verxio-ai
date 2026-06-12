from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from app import db
from app.models import AgentProfile, RuntimeInstance, Workspace, new_id, utc_now


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
VERXIO_STATE_DIR = WORKSPACE_ROOT / ".verxio"
RUNTIME_ROOT = Path(os.getenv("VERXIO_RUNTIME_ROOT", str(VERXIO_STATE_DIR / "runtimes"))).expanduser()

DEFAULT_CAPABILITIES = [
    "Use the model/provider configured in Hermes",
    "Run Hermes tools, skills, MCP servers, and gateway connections through the runtime",
    "Keep user-agent memory inside the isolated Hermes home",
    "Write generated files to the workspace artifacts directory",
]

DEFAULT_STARTERS = [
    "Help me understand this workspace and decide what to build next.",
    "Create a useful report and save it as a Verxio artifact.",
    "Inspect the runtime setup and tell me what is ready.",
]


def now_iso() -> str:
    return utc_now().isoformat()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug[:64] or "workspace"


def safe_path_part(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "_", value).strip("._") or "item"


def runtime_base_path(workspace_id: str, agent_id: str) -> Path:
    return RUNTIME_ROOT / safe_path_part(workspace_id) / safe_path_part(agent_id)


def runtime_paths(workspace_id: str, agent_id: str) -> dict[str, str]:
    base = runtime_base_path(workspace_id, agent_id)
    return {
        "hermes_home_path": str(base / "hermes-home"),
        "workspace_path": str(base / "workspace"),
        "artifact_path": str(base / "workspace" / "artifacts"),
    }


def ensure_runtime_directories(runtime: RuntimeInstance) -> None:
    hermes_home = Path(runtime.hermes_home_path)
    workspace = Path(runtime.workspace_path)
    artifacts = Path(runtime.artifact_path)

    for path in (hermes_home, workspace, artifacts):
        path.mkdir(parents=True, exist_ok=True)

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
        soul_path.write_text(
            "\n".join(
                [
                    "# Verxio Agent",
                    "",
                    "You are a Hermes-powered Verxio agent running in an isolated workspace.",
                    "Treat `/workspace` as the working directory.",
                    "Put generated reports, dashboards, documents, images, and exports in `/workspace/artifacts`.",
                    "When you mention a generated file, give its `/workspace/artifacts/...` path so Verxio can index it.",
                    "",
                ]
            ),
            encoding="utf-8",
        )


def workspace_from_row(row: dict[str, Any]) -> Workspace:
    return Workspace(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        name=str(row["name"]),
        slug=str(row["slug"]),
        kind=str(row["kind"]),
        region="Hosted",
        plan="Hermes runtime workspace",
    )


def agent_from_row(row: dict[str, Any]) -> AgentProfile:
    return AgentProfile(
        id=str(row["id"]),
        tenant_id=str(row["tenant_id"]),
        workspace_id=str(row["workspace_id"]),
        name=str(row["name"]),
        role=str(row["role"]),
        status=str(row["status"]),  # type: ignore[arg-type]
        description=str(row["description"]),
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
    )


def ensure_personal_workspace(user: dict[str, Any]) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
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
                    "Hermes-powered assistant",
                    "A Verxio interface over an isolated Hermes Agent runtime.",
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
    ensure_runtime_directories(runtime)
    return workspace, agent, runtime


def ensure_runtime_instance(workspace: Workspace, agent: AgentProfile) -> RuntimeInstance:
    row = db.fetch_one(
        "SELECT * FROM runtime_instances WHERE workspace_id = ? AND agent_id = ?",
        (workspace.id, agent.id),
    )
    if not row:
        created_at = now_iso()
        paths = runtime_paths(workspace.id, agent.id)
        runtime_id = new_id("rt")
        with db.transaction() as conn:
            conn.execute(
                """
                INSERT INTO runtime_instances (
                    id, tenant_id, workspace_id, agent_id, mode, status, image,
                    hermes_home_path, workspace_path, artifact_path, created_at, updated_at
                )
                VALUES (?, ?, ?, ?, ?, 'stopped', ?, ?, ?, ?, ?, ?)
                """,
                (
                    runtime_id,
                    workspace.tenant_id,
                    workspace.id,
                    agent.id,
                    os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker"),
                    os.getenv("VERXIO_HERMES_IMAGE", "nousresearch/hermes-agent:latest"),
                    paths["hermes_home_path"],
                    paths["workspace_path"],
                    paths["artifact_path"],
                    created_at,
                    created_at,
                ),
            )
        row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime_id,))
    return runtime_from_row(row or {})


def get_context_for_user(user: dict[str, Any]) -> tuple[Workspace, AgentProfile, RuntimeInstance]:
    return ensure_personal_workspace(user)


def get_runtime_for_user(user: dict[str, Any], agent_id: str | None = None) -> RuntimeInstance:
    workspace, agent, runtime = get_context_for_user(user)
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
    }
    fields = {key: value for key, value in patch.items() if key in allowed}
    fields["updated_at"] = now_iso()
    assignments = ", ".join(f"{key} = ?" for key in fields)
    db.execute(
        f"UPDATE runtime_instances SET {assignments} WHERE id = ?",
        (*fields.values(), runtime.id),
    )
    row = db.fetch_one("SELECT * FROM runtime_instances WHERE id = ?", (runtime.id,))
    return runtime_from_row(row or {})


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
