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
    "CREATE INDEX IF NOT EXISTS idx_sessions_token_hash ON sessions(token_hash)",
    "CREATE INDEX IF NOT EXISTS idx_workspace_members_user ON workspace_members(user_id)",
    "CREATE INDEX IF NOT EXISTS idx_agents_workspace ON agents(workspace_id)",
    "CREATE INDEX IF NOT EXISTS idx_runtime_agent ON runtime_instances(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_artifacts_agent ON artifacts(workspace_id, agent_id)",
    "CREATE INDEX IF NOT EXISTS idx_auth_codes_lookup ON auth_codes(email, purpose, consumed_at)",
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
