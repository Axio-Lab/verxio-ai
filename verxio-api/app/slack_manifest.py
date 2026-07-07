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


def _rebrand_manifest_for_verxio(
    manifest: dict[str, object],
    bot_name: str,
) -> dict[str, object]:
    """Rewrite Hermes-specific manifest copy for Verxio-hosted manifests."""
    features = manifest.get("features")
    if isinstance(features, dict):
        assistant_view = features.get("assistant_view")
        if isinstance(assistant_view, dict):
            assistant_view["assistant_description"] = (
                f"Chat with {bot_name} in threads and DMs."
            )

        slash_commands = features.get("slash_commands")
        if isinstance(slash_commands, list):
            for entry in slash_commands:
                if not isinstance(entry, dict):
                    continue
                if entry.get("command") == "/hermes":
                    entry["command"] = "/verxio"
                for key in ("description", "usage_hint"):
                    value = entry.get(key)
                    if isinstance(value, str):
                        entry[key] = value.replace("Hermes", bot_name).replace(
                            "/hermes",
                            "/verxio",
                        )

    display = manifest.get("display_information")
    if isinstance(display, dict):
        desc = display.get("description")
        if isinstance(desc, str):
            display["description"] = desc.replace("Hermes", bot_name)

    return manifest


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
    manifest = _rebrand_manifest_for_verxio(manifest, bot_name)
    return {
        "manifest": manifest,
        "json": json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
    }
