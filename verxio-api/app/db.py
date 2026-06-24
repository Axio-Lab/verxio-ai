from __future__ import annotations

import os
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Iterator


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
VERXIO_STATE_DIR = WORKSPACE_ROOT / ".verxio"
MIGRATIONS_DIR = WORKSPACE_ROOT / "migrations"


@dataclass(frozen=True)
class DatabaseSettings:
    mode: str
    turso_url: str
    turso_auth_token: str
    local_path: Path


def get_database_settings() -> DatabaseSettings:
    mode = os.getenv("VERXIO_DATABASE_MODE", "auto").strip().lower() or "auto"
    turso_url = os.getenv("TURSO_DATABASE_URL", "").strip()
    turso_auth_token = os.getenv("TURSO_AUTH_TOKEN", "").strip()
    local_path = Path(
        os.getenv("VERXIO_DATABASE_PATH", str(VERXIO_STATE_DIR / "verxio-control.sqlite3"))
    ).expanduser()

    if mode == "auto":
        mode = "turso" if turso_url else "sqlite"

    return DatabaseSettings(
        mode=mode,
        turso_url=turso_url,
        turso_auth_token=turso_auth_token,
        local_path=local_path,
    )


SCHEMA_STATEMENTS: tuple[str, ...] = (
    """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        ip_address TEXT,
        user_agent TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        name TEXT NOT NULL,
        slug TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'personal',
        created_by TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS workspace_members (
        workspace_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, user_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL,
        description TEXT NOT NULL,
        hermes_home_path TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS runtime_instances (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        mode TEXT NOT NULL DEFAULT 'local-docker',
        status TEXT NOT NULL,
        container_id TEXT,
        container_name TEXT,
        image TEXT,
        dashboard_url TEXT,
        dashboard_token TEXT,
        hermes_home_path TEXT NOT NULL,
        workspace_path TEXT NOT NULL,
        artifact_path TEXT NOT NULL,
        last_started_at TEXT,
        last_seen_at TEXT,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        relative_path TEXT NOT NULL,
        absolute_path TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT,
        source TEXT NOT NULL DEFAULT 'workspace',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_id, relative_path),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS auth_codes (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        user_id TEXT,
        purpose TEXT NOT NULL,
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notepad_folders (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notepad_notes (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        folder_id TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL DEFAULT '',
        transcript TEXT NOT NULL DEFAULT '',
        summary TEXT NOT NULL DEFAULT '',
        meeting_type TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT 'manual',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (folder_id) REFERENCES notepad_folders(id) ON DELETE SET NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS notepad_shares (
        id TEXT PRIMARY KEY,
        token TEXT NOT NULL UNIQUE,
        note_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        revoked_at TEXT,
        FOREIGN KEY (note_id) REFERENCES notepad_notes(id) ON DELETE CASCADE,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT,
        agent_id TEXT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        summary TEXT NOT NULL,
        status TEXT NOT NULL,
        metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_channels (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        external_id TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'draft',
        capabilities_json TEXT NOT NULL DEFAULT '{}',
        credentials_encrypted TEXT NOT NULL DEFAULT '',
        webhook_secret TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_id, channel_type, external_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_contacts (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        external_user_id TEXT NOT NULL,
        username TEXT,
        display_name TEXT NOT NULL,
        fields_json TEXT NOT NULL DEFAULT '{}',
        consent_state TEXT NOT NULL DEFAULT 'unknown',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (channel_id, external_user_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_conversations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'automated',
        window_expires_at TEXT,
        last_inbound_at TEXT,
        last_outbound_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (channel_id, contact_id),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE CASCADE,
        FOREIGN KEY (contact_id) REFERENCES pulse_contacts(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_messages (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '',
        media_json TEXT NOT NULL DEFAULT '[]',
        provider_message_id TEXT,
        status TEXT NOT NULL DEFAULT 'received',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES pulse_conversations(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_automations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        channel_type TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 0,
        flow_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_runs (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        automation_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        cursor_node_id TEXT,
        wait_until TEXT,
        context_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE,
        FOREIGN KEY (automation_id) REFERENCES pulse_automations(id) ON DELETE CASCADE,
        FOREIGN KEY (conversation_id) REFERENCES pulse_conversations(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_tags (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        workspace_id TEXT NOT NULL,
        agent_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT 'primary',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE (workspace_id, agent_id, name),
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_contact_tags (
        contact_id TEXT NOT NULL,
        tag_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (contact_id, tag_id),
        FOREIGN KEY (contact_id) REFERENCES pulse_contacts(id) ON DELETE CASCADE,
        FOREIGN KEY (tag_id) REFERENCES pulse_tags(id) ON DELETE CASCADE
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS pulse_events (
        id TEXT PRIMARY KEY,
        tenant_id TEXT,
        workspace_id TEXT,
        agent_id TEXT,
        channel_id TEXT,
        channel_type TEXT NOT NULL,
        provider_event_id TEXT,
        signature_ok INTEGER NOT NULL DEFAULT 0,
        processed INTEGER NOT NULL DEFAULT 0,
        payload_json TEXT NOT NULL DEFAULT '{}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE SET NULL,
        FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL,
        FOREIGN KEY (channel_id) REFERENCES pulse_channels(id) ON DELETE SET NULL
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)",
    "CREATE INDEX IF NOT EXISTS idx_runtime_agent ON runtime_instances(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_artifacts_agent ON artifacts(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup ON auth_codes(email, purpose, consumed_at)",
    "CREATE INDEX IF NOT EXISTS idx_notepad_folders_agent ON notepad_folders(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_notepad_notes_agent ON notepad_notes(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_notepad_notes_folder ON notepad_notes(folder_id)",
    "CREATE INDEX IF NOT EXISTS idx_notepad_shares_token ON notepad_shares(token)",
    "CREATE INDEX IF NOT EXISTS idx_notepad_shares_note ON notepad_shares(note_id, revoked_at)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_channels_agent ON pulse_channels(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_channels_external ON pulse_channels(channel_type, external_id)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_contacts_channel ON pulse_contacts(channel_id, external_user_id)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_conversations_agent ON pulse_conversations(workspace_id, agent_id, updated_at)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_messages_conversation ON pulse_messages(conversation_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_automations_agent ON pulse_automations(workspace_id, agent_id, enabled)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_runs_wait ON pulse_runs(status, wait_until)",
    "CREATE INDEX IF NOT EXISTS idx_pulse_events_channel ON pulse_events(channel_type, channel_id, created_at)",
)


def _connect_sqlite(path: Path) -> sqlite3.Connection:
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _connect_turso(settings: DatabaseSettings):
    try:
        import libsql  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "VERXIO_DATABASE_MODE=turso requires the Python `libsql` package. "
            "Install verxio-api dependencies or set VERXIO_DATABASE_MODE=sqlite for local fallback."
        ) from exc

    if not settings.turso_url:
        raise RuntimeError("TURSO_DATABASE_URL is required when VERXIO_DATABASE_MODE=turso.")

    kwargs: dict[str, str] = {"database": settings.turso_url}
    if settings.turso_auth_token:
        kwargs["auth_token"] = settings.turso_auth_token
    return libsql.connect(**kwargs)


@contextmanager
def connection() -> Iterator[Any]:
    settings = get_database_settings()
    conn = _connect_turso(settings) if settings.mode == "turso" else _connect_sqlite(settings.local_path)
    try:
        yield conn
        if hasattr(conn, "commit"):
            conn.commit()
    finally:
        if hasattr(conn, "close"):
            conn.close()


def _cursor_to_dicts(cursor: Any) -> list[dict[str, Any]]:
    columns = [item[0] for item in (cursor.description or [])]
    rows = cursor.fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        if isinstance(row, sqlite3.Row):
            result.append(dict(row))
        elif isinstance(row, dict):
            result.append(row)
        else:
            result.append(dict(zip(columns, row)))
    return result


def run_migrations() -> None:
    with connection() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version TEXT PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
            """
        )
        migration_files = sorted(MIGRATIONS_DIR.glob("*.sql")) if MIGRATIONS_DIR.exists() else []
        if migration_files:
            for migration in migration_files:
                version = migration.stem
                applied = conn.execute("SELECT version FROM schema_migrations WHERE version = ?", (version,))
                if _cursor_to_dicts(applied):
                    continue
                for statement in _split_sql_script(migration.read_text(encoding="utf-8")):
                    conn.execute(statement)
                conn.execute("INSERT INTO schema_migrations (version) VALUES (?)", (version,))
        else:
            for statement in SCHEMA_STATEMENTS:
                conn.execute(statement)


def _split_sql_script(script: str) -> list[str]:
    statements: list[str] = []
    buffer: list[str] = []

    for line in script.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        buffer.append(line)
        if stripped.endswith(";"):
            statement = "\n".join(buffer).strip().rstrip(";").strip()
            if statement:
                statements.append(statement)
            buffer = []

    tail = "\n".join(buffer).strip()
    if tail:
        statements.append(tail)

    return statements


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with connection() as conn:
        conn.execute(sql, tuple(params))


def fetch_one(sql: str, params: Iterable[Any] = ()) -> dict[str, Any] | None:
    with connection() as conn:
        cursor = conn.execute(sql, tuple(params))
        rows = _cursor_to_dicts(cursor)
        return rows[0] if rows else None


def fetch_all(sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
    with connection() as conn:
        cursor = conn.execute(sql, tuple(params))
        return _cursor_to_dicts(cursor)


@contextmanager
def transaction() -> Iterator[Any]:
    with connection() as conn:
        try:
            yield conn
            if hasattr(conn, "commit"):
                conn.commit()
        except Exception:
            if hasattr(conn, "rollback"):
                conn.rollback()
            raise
