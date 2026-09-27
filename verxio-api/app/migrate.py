"""Deploy-step migrations: ``python -m app.migrate``."""

from __future__ import annotations

import logging
import sys

from app import db

logger = logging.getLogger("verxio.migrate")


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    settings = db.get_database_settings()
    logger.info("Applying migrations mode=%s path=%s", settings.mode, settings.local_path)
    db.run_migrations()
    ping = db.ping()
    logger.info("Migrations complete ping=%s", ping)
    return 0 if ping.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
