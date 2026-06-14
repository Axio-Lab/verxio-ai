from __future__ import annotations

import json
import os
import stat
from pathlib import Path
from typing import Any

from app.models import RuntimeInstance


def leash_agent_path(runtime: RuntimeInstance) -> Path:
    """Leash MCP reads ~/.config/leash/agent.json; HERMES_HOME is the runtime home."""
    return Path(runtime.hermes_home_path) / ".config" / "leash" / "agent.json"


def read_leash_agent(runtime: RuntimeInstance) -> dict[str, Any] | None:
    path = leash_agent_path(runtime)
    if not path.is_file():
        return None
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def write_leash_agent(runtime: RuntimeInstance, payload: dict[str, Any]) -> None:
    path = leash_agent_path(runtime)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.chmod(path, stat.S_IRUSR | stat.S_IWUSR)


def clear_leash_agent(runtime: RuntimeInstance) -> None:
    path = leash_agent_path(runtime)
    if path.is_file():
        path.unlink()
