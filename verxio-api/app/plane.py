"""Per-tenant runtime plane (dual-run flag).

During cutover every (workspace, agent) carries a *plane* in
``runtime_plane_flags``: ``pool`` (worker pool), ``docker`` (legacy per-user
container) or ``k8s``. Tenants without a row use the process default
(``VERXIO_RUNTIME_MANAGER``). Every code path that needs a runtime backend for
a tenant resolves it here, so a tenant can be moved between planes with a
single row update:

    python -m app.plane get <workspace_id> <agent_id>
    python -m app.plane set <workspace_id> <agent_id> pool
    python -m app.plane list [--plane pool]
    python -m app.plane migrate-all pool   # flip every tenant without a row

Lookups are cached for a short TTL (in Redis when available, else in-process)
because the WS proxy and artifact routes hit this on every request.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from typing import Iterable

from datetime import datetime, timezone

from app import db
from app.infra import redis as infra


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()

PLANES = {"pool", "docker", "k8s"}
_ALIASES = {
    "pool": "pool",
    "worker-pool": "pool",
    "workers": "pool",
    "docker": "docker",
    "local-docker": "docker",
    "local": "docker",
    "k8s": "k8s",
    "kubernetes": "k8s",
}
_MANAGER_FOR_PLANE = {"pool": "pool", "docker": "local-docker", "k8s": "k8s"}

_CACHE_TTL = float(os.getenv("VERXIO_PLANE_CACHE_SECONDS", "15") or 15)
_LOCAL: dict[tuple[str, str], tuple[float, str]] = {}


def normalize_plane(value: str | None) -> str:
    key = (value or "").strip().lower()
    if key in _ALIASES:
        return _ALIASES[key]
    raise ValueError(f"unknown plane {value!r} (expected pool|docker|k8s)")


def default_plane() -> str:
    raw = os.getenv("VERXIO_RUNTIME_MANAGER", "local-docker") or "local-docker"
    try:
        return normalize_plane(raw)
    except ValueError:
        return "docker"


def manager_name_for_plane(plane: str) -> str:
    return _MANAGER_FOR_PLANE[normalize_plane(plane)]


def _cache_key(workspace_id: str, agent_id: str) -> str:
    return f"plane:{workspace_id}:{agent_id}"


def resolve_plane(workspace_id: str, agent_id: str) -> str:
    """Plane for a tenant: flag row, else the process default."""
    key = (workspace_id, agent_id)
    now = time.monotonic()
    hit = _LOCAL.get(key)
    if hit and hit[0] > now:
        return hit[1]
    cached = infra.cache_get(_cache_key(workspace_id, agent_id))
    if cached:
        _LOCAL[key] = (now + _CACHE_TTL, cached)
        return cached
    row = db.fetch_one(
        "SELECT plane FROM runtime_plane_flags WHERE workspace_id = ? AND agent_id = ?",
        (workspace_id, agent_id),
    )
    plane = default_plane()
    if row and row.get("plane"):
        try:
            plane = normalize_plane(row["plane"])
        except ValueError:
            plane = default_plane()
    _LOCAL[key] = (now + _CACHE_TTL, plane)
    infra.cache_set(_cache_key(workspace_id, agent_id), plane, ttl_seconds=_CACHE_TTL)
    return plane


def tenant_uses_pool(workspace_id: str, agent_id: str) -> bool:
    return resolve_plane(workspace_id, agent_id) == "pool"


def set_plane(workspace_id: str, agent_id: str, plane: str) -> str:
    normalized = normalize_plane(plane)
    db.execute(
        """
        INSERT INTO runtime_plane_flags (workspace_id, agent_id, plane, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, agent_id) DO UPDATE SET
            plane = excluded.plane,
            updated_at = excluded.updated_at
        """,
        (workspace_id, agent_id, normalized, now_iso()),
    )
    invalidate(workspace_id, agent_id)
    return normalized


def invalidate(workspace_id: str, agent_id: str) -> None:
    _LOCAL.pop((workspace_id, agent_id), None)
    infra.cache_delete(_cache_key(workspace_id, agent_id))


def list_planes(plane: str | None = None) -> list[dict]:
    if plane:
        return db.fetch_all(
            "SELECT workspace_id, agent_id, plane, updated_at FROM runtime_plane_flags WHERE plane = ? ORDER BY updated_at DESC",
            (normalize_plane(plane),),
        )
    return db.fetch_all(
        "SELECT workspace_id, agent_id, plane, updated_at FROM runtime_plane_flags ORDER BY updated_at DESC"
    )


def tenants_without_flag() -> Iterable[tuple[str, str]]:
    rows = db.fetch_all(
        """
        SELECT r.workspace_id, r.agent_id FROM runtime_instances r
        LEFT JOIN runtime_plane_flags f
          ON f.workspace_id = r.workspace_id AND f.agent_id = r.agent_id
        WHERE f.workspace_id IS NULL
        """
    )
    return [(row["workspace_id"], row["agent_id"]) for row in rows]


def migrate_all(plane: str) -> int:
    count = 0
    for workspace_id, agent_id in tenants_without_flag():
        set_plane(workspace_id, agent_id, plane)
        count += 1
    return count


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.plane", description=__doc__.split("\n\n")[0])
    sub = parser.add_subparsers(dest="cmd", required=True)
    p_get = sub.add_parser("get")
    p_get.add_argument("workspace_id")
    p_get.add_argument("agent_id")
    p_set = sub.add_parser("set")
    p_set.add_argument("workspace_id")
    p_set.add_argument("agent_id")
    p_set.add_argument("plane", choices=sorted(_ALIASES))
    p_list = sub.add_parser("list")
    p_list.add_argument("--plane", default=None)
    p_mig = sub.add_parser("migrate-all")
    p_mig.add_argument("plane", choices=sorted(_ALIASES))
    args = parser.parse_args(argv)

    if args.cmd == "get":
        print(resolve_plane(args.workspace_id, args.agent_id))
    elif args.cmd == "set":
        print(set_plane(args.workspace_id, args.agent_id, args.plane))
    elif args.cmd == "list":
        print(json.dumps(list_planes(args.plane), indent=2))
    elif args.cmd == "migrate-all":
        print(f"flagged {migrate_all(args.plane)} tenant(s) -> {normalize_plane(args.plane)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
