"""Consistent-hash assignment of socket-channel tenants to gateway shards."""

from __future__ import annotations

import hashlib
import os
from typing import Iterable


SOCKET_PLATFORMS = frozenset({"whatsapp", "discord"})
WEBHOOK_PLATFORMS = frozenset({"telegram", "slack"})


def shard_count() -> int:
    try:
        return max(1, int(os.getenv("VERXIO_CHANNEL_SHARDS", "2")))
    except ValueError:
        return 2


def shard_for(workspace_id: str, agent_id: str, *, shards: int | None = None) -> int:
    count = shards or shard_count()
    digest = hashlib.sha256(f"{workspace_id}:{agent_id}".encode("utf-8")).hexdigest()
    return int(digest[:8], 16) % count


def shard_key(workspace_id: str, agent_id: str) -> str:
    return f"shard-{shard_for(workspace_id, agent_id)}"


def shard_base_url(index: int) -> str:
    template = os.getenv("VERXIO_CHANNEL_SHARD_URL", "http://verxio-channel-gateway-{i}:9119")
    return template.replace("{i}", str(index)).rstrip("/")


def pairing_url(workspace_id: str, agent_id: str, path: str = "") -> str:
    return f"{shard_base_url(shard_for(workspace_id, agent_id))}/{path.lstrip('/')}"


def all_shards(count: int | None = None) -> Iterable[int]:
    return range(count or shard_count())


def drain_plan(lost_shard: int, *, shards: int | None = None) -> list[int]:
    """Shards that should absorb tenants when ``lost_shard`` is down."""
    count = shards or shard_count()
    return [index for index in range(count) if index != lost_shard]
