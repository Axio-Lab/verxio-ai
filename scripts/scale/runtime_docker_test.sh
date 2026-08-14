#!/usr/bin/env bash
# Real Docker runtime wake/stop smoke (Phase 1 CI).
# Requires: docker, verxio-hermes-runtime:local (or VERXIO_HERMES_IMAGE), uv.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/verxio-api"

export VERXIO_DATABASE_MODE=sqlite
export VERXIO_DATABASE_PATH="${VERXIO_DATABASE_PATH:-/tmp/verxio-scale-ci.sqlite3}"
export VERXIO_RUNTIME_MANAGER=local-docker
export VERXIO_RUNTIME_RESTART_POLICY=no
export VERXIO_RUNTIME_IDLE_ENABLED=true
export VERXIO_HERMES_IMAGE="${VERXIO_HERMES_IMAGE:-verxio-hermes-runtime:local}"
export VERXIO_STATE_DIR="${VERXIO_STATE_DIR:-/tmp/verxio-scale-ci-state}"
export VERXIO_RUNTIME_ROOT="$VERXIO_STATE_DIR/runtimes"
rm -f "$VERXIO_DATABASE_PATH"
mkdir -p "$VERXIO_STATE_DIR"

if ! docker image inspect "$VERXIO_HERMES_IMAGE" >/dev/null 2>&1; then
  echo "Missing image $VERXIO_HERMES_IMAGE — build with:"
  echo "  docker compose -f docker-compose.verxio.yml --profile image build hermes-runtime-image"
  exit 1
fi

uv sync --extra dev
uv run pytest tests/runtime_orch -v

uv run python - <<'PY'
import asyncio
import os

from app import db
from app.auth import hash_password
from app.control_plane import get_runtime_for_user, now_iso
from app.models import new_id
from app.runtime_orch.lifecycle import drain_runtime, wake_runtime

db.run_migrations()
email = "scale-ci@verxio.test"
existing = db.fetch_one("SELECT * FROM users WHERE email = ?", (email,))
if not existing:
    uid = new_id("user")
    db.execute(
        """
        INSERT INTO users (id, email, name, password_hash, email_verified, created_at, updated_at)
        VALUES (?, ?, ?, ?, 1, ?, ?)
        """,
        (uid, email, "Scale CI", hash_password("scale-ci-password-123"), now_iso(), now_iso()),
    )
    user = db.fetch_one("SELECT * FROM users WHERE id = ?", (uid,))
else:
    user = existing

runtime = get_runtime_for_user(user)
print("runtime", runtime.id, runtime.status)

async def main():
    started = await wake_runtime(runtime, wait_ready=True, reason="ci")
    print("started", started.status, started.container_name, started.last_error)
    assert started.status in {"running", "starting"}, started
    drained = await drain_runtime(started)
    print("drained", drained.status)
    assert drained.status == "stopped", drained

asyncio.run(main())
print("OK real docker wake/drain")
PY
