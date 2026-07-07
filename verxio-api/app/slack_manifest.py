from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def _hermes_repo_path() -> Path:
    candidates: list[Path] = []

    configured = os.getenv("VERXIO_HERMES_REPO", "").strip()
    if configured:
        candidates.append(Path(configured).expanduser())

    candidates.extend(
        [
            Path(__file__).resolve().parents[2] / "hermes-agent",
            Path("/opt/hermes-agent"),
        ]
    )

    for candidate in candidates:
        if (candidate / "hermes_cli").is_dir():
            return candidate

    raise RuntimeError(
        "Hermes agent sources are not available for Slack manifest generation."
    )


def _ensure_hermes_import_path() -> Path:
    repo = _hermes_repo_path()
    repo_str = str(repo)
    if repo_str not in sys.path:
        sys.path.insert(0, repo_str)

    return repo


def build_slack_manifest(
    *,
    name: str = "Verxio",
    description: str | None = None,
    include_assistant: bool = True,
) -> dict[str, object]:
    _ensure_hermes_import_path()
    from hermes_cli.slack_cli import _build_full_manifest

    bot_name = (name or "Verxio").strip() or "Verxio"
    bot_description = (description or f"Your {bot_name} agent on Slack").strip()
    manifest = _build_full_manifest(
        bot_name,
        bot_description,
        include_assistant=include_assistant,
    )
    return {
        "manifest": manifest,
        "json": json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    }
