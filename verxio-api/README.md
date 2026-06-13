# Verxio API

FastAPI control plane for Verxio's Hermes runtime product.

## Responsibilities

- Native email/password auth, email-code login, email verification, password reset, logout, and `/api/auth/me`
- Turso/libSQL migrations and typed query helpers
- Personal workspace and default Verxio agent provisioning
- Runtime registry for isolated Hermes containers
- Authenticated REST and WebSocket proxy to the correct Hermes runtime
- Artifact indexing and preview/download routes

Hermes still owns model configuration, memory, sessions, tools, skills, MCP servers, cron jobs, gateway connections, and self-improvement state inside each isolated `HERMES_HOME`.

## Database

Production uses Turso/libSQL:

```bash
export VERXIO_DATABASE_MODE=turso
export TURSO_DATABASE_URL=libsql://your-database.turso.io
export TURSO_AUTH_TOKEN=your-token
```

Offline development can use SQLite:

```bash
export VERXIO_DATABASE_MODE=sqlite
export VERXIO_DATABASE_PATH=../.verxio/verxio-control.sqlite3
```

SQL migrations live in `migrations/`. `app.db.run_migrations()` applies them on API startup and records applied versions in `schema_migrations`.

## Runtime State

Each agent runtime is isolated by workspace and agent:

```text
.verxio/runtimes/{workspace_id}/{agent_id}/hermes-home
.verxio/runtimes/{workspace_id}/{agent_id}/workspace
.verxio/runtimes/{workspace_id}/{agent_id}/workspace/artifacts
```

Verxio stores metadata in Turso. It does not store Hermes memory bytes, session files, skills, cron files, or generated artifacts in Turso.

## Auth And Email Codes

Passwords are stored as salted one-way PBKDF2-SHA256 hashes. Verification, login, and password reset codes are stored as HMAC-SHA256 hashes with expiry and attempt limits.

Configure production email delivery with SMTP:

```bash
export VERXIO_AUTH_CODE_SECRET=change-this-long-random-secret
export VERXIO_SMTP_HOST=smtp.example.com
export VERXIO_SMTP_PORT=587
export VERXIO_SMTP_USERNAME=your-smtp-username
export VERXIO_SMTP_PASSWORD=your-smtp-password
export VERXIO_SMTP_FROM="Verxio <no-reply@example.com>"
```

When SMTP is not configured, local development logs auth codes to the API process for testing.

## Local Development

```bash
uv sync --extra dev
VERXIO_DATABASE_MODE=sqlite uv run uvicorn app.main:app --reload --port 8787
```

API docs:

```text
http://127.0.0.1:8787/docs
```

## Key Routes

- `POST /api/auth/signup`
- `POST /api/auth/verify-email`
- `POST /api/auth/verification/resend`
- `POST /api/auth/login`
- `POST /api/auth/login/code/request`
- `POST /api/auth/login/code/verify`
- `POST /api/auth/password/forgot`
- `POST /api/auth/password/reset`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/runtime`
- `POST /api/runtime/start`
- `POST /api/runtime/stop`
- `POST /api/runtime/restart`
- `GET /api/runtime/dashboard/{path}` proxy to Hermes REST
- `GET /api/runtime/dashboard/ws/{path}` proxy to Hermes WebSocket
- `GET /api/artifacts`
- `GET /api/artifacts/{id}`
- `GET /api/artifacts/{id}/preview`
- `GET /api/artifacts/{id}/download`

## Docker Runtime Env

When the API runs inside Docker and controls host Docker through `/var/run/docker.sock`, set:

```bash
VERXIO_RUNTIME_ROOT=/app/.verxio/runtimes
VERXIO_RUNTIME_DOCKER_ROOT=/absolute/host/path/to/.verxio/runtimes
VERXIO_HERMES_IMAGE=verxio-hermes-runtime:local
```

`VERXIO_RUNTIME_DOCKER_ROOT` is the host path used in `docker run -v` for Hermes runtime containers.

## Tests

```bash
uv run pytest
```
