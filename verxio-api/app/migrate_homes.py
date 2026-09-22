"""Upload existing hermes-homes to object storage and mark dual-run flags."""

from __future__ import annotations

import logging
import sys
from pathlib import Path

from app import db
from app.control_plane import now_iso, runtime_from_row
from app.homes import sync_home

logger = logging.getLogger("verxio.migrate_homes")


def migrate_all(*, plane: str = "pool") -> dict[str, int]:
    db.run_migrations()
    rows = db.fetch_all("SELECT * FROM runtime_instances")
    uploaded = 0
    flagged = 0
    for row in rows:
        runtime = runtime_from_row(row)
        home = Path(runtime.hermes_home_path)
        if home.exists():
            if sync_home(runtime):
                uploaded += 1
        db.execute(
            """
            INSERT INTO runtime_plane_flags (workspace_id, agent_id, plane, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(workspace_id, agent_id) DO UPDATE SET plane = excluded.plane, updated_at = excluded.updated_at
            """,
            (runtime.workspace_id, runtime.agent_id, plane, now_iso()),
        )
        flagged += 1
    return {"uploaded": uploaded, "flagged": flagged, "total": len(rows)}


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    result = migrate_all()
    logger.info("Home migration complete %s", result)
    return 0


if __name__ == "__main__":
    sys.exit(main())
