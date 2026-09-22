"""Per-tenant Hermes runtime env, sealed at rest.

The API computes a tenant's runtime env (hosted provider keys, inference
bridge, dashboard token, control-plane URLs) exactly as it did for per-user
containers. In the worker pool there is no container to inject it into, so
it is sealed here and materialised into ``{home}/.env`` by the worker that
attaches the tenant. Redis never carries it.
"""

from __future__ import annotations

import json

from app import db
from app.control_plane import now_iso
from app.secrets_box import decrypt_text, encrypt_text


def _aad(workspace_id: str, agent_id: str) -> str:
    return f"tenant-env:{workspace_id}:{agent_id}"


def save_tenant_env(workspace_id: str, agent_id: str, env: dict[str, str]) -> None:
    clean = {str(k): str(v) for k, v in env.items() if k and v is not None}
    blob = encrypt_text(json.dumps(clean, separators=(",", ":"), sort_keys=True), aad=_aad(workspace_id, agent_id))
    now = now_iso()
    db.execute(
        """
        INSERT INTO tenant_runtime_env (workspace_id, agent_id, ciphertext, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
            ciphertext = excluded.ciphertext,
            updated_at = excluded.updated_at
        """,
        (workspace_id, agent_id, blob, now),
    )


def load_tenant_env(workspace_id: str, agent_id: str) -> dict[str, str]:
    row = db.fetch_one(
        "SELECT ciphertext FROM tenant_runtime_env WHERE workspace_id = ? AND agent_id = ?",
        (workspace_id, agent_id),
    )
    if not row:
        return {}
    parsed = json.loads(decrypt_text(str(row["ciphertext"]), aad=_aad(workspace_id, agent_id)))
    return {str(k): str(v) for k, v in parsed.items()} if isinstance(parsed, dict) else {}


def tenant_env_updated_at(workspace_id: str, agent_id: str) -> str | None:
    row = db.fetch_one(
        "SELECT updated_at FROM tenant_runtime_env WHERE workspace_id = ? AND agent_id = ?",
        (workspace_id, agent_id),
    )
    return str(row["updated_at"]) if row else None
