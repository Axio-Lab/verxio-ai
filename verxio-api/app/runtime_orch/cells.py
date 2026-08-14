"""Tenant cell routing stub (Phase 5/6)."""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Cell:
    id: str
    region: str
    control_db: str | None = None
    runtime_backend: str | None = None


def default_cell_id() -> str:
    return os.getenv("VERXIO_DEFAULT_CELL_ID", "cell_default").strip() or "cell_default"


def cell_for_tenant(tenant_id: str, *, cell_count: int | None = None) -> Cell:
    """Deterministic cell assignment. Single-cell until multi-cell deploy."""
    count = cell_count or int(os.getenv("VERXIO_CELL_COUNT", "1") or "1")
    if count <= 1:
        cell_id = default_cell_id()
    else:
        digest = hashlib.sha256(tenant_id.encode("utf-8")).hexdigest()
        idx = int(digest[:8], 16) % count
        cell_id = f"cell_{idx}"
    region = os.getenv("VERXIO_CELL_REGION", "default")
    return Cell(
        id=cell_id,
        region=region,
        control_db=os.getenv("VERXIO_CELL_CONTROL_DB"),
        runtime_backend=os.getenv("VERXIO_RUNTIME_MANAGER"),
    )
