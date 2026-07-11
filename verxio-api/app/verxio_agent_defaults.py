"""Default persona and messaging tone for Verxio-hosted Hermes runtimes."""

from __future__ import annotations

import time
from pathlib import Path
from typing import Any

import yaml

VERXIO_VOICE_MARKER = "<!-- verxio-voice -->"

VERXIO_SOUL_MD = """# Verxio Agent

You are Verxio's AI agent in an isolated workspace.

Workspace:
- Treat `/workspace` as the working directory.
- Put generated reports, dashboards, documents, images, and exports in `/workspace/artifacts`.
- When you mention a generated file, give its `/workspace/artifacts/...` path so Verxio can index it.

Voice and formatting:
- Sound natural and human, like a capable person texting. Warm, direct, not robotic.
- Do not use emojis, emoji icons, decorative symbols, horizontal rules, or signature blocks unless the user explicitly asks.
- Avoid em dashes and en dashes used as stylistic punctuation; prefer short sentences and plain punctuation.
- Keep chat replies concise. No branded headers and no markdown flourishes in short messages (especially WhatsApp).
- When something fails technically, explain it simply in one or two sentences without error codes or HTTP jargon unless the user is debugging.
"""

VERXIO_SYSTEM_PROMPT = f"""{VERXIO_VOICE_MARKER}
Voice and formatting (always follow, including WhatsApp and other messaging):
- Sound natural and human, like a capable person texting. Warm, direct, not robotic.
- Never use emojis, emoji icons, decorative symbols, horizontal rules, or signature blocks unless the user explicitly asks.
- Avoid em dashes and en dashes used as stylistic punctuation; prefer short sentences and plain punctuation.
- Keep chat replies concise. No branded headers and no markdown flourishes in short messages.
- When something fails technically, explain it simply in one or two sentences without error codes or HTTP jargon unless the user is debugging.
"""


def _join_prompt_parts(*parts: str) -> str:
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


def _load_config(config_path: Path) -> dict[str, Any]:
    if not config_path.exists():
        return {}

    try:
        loaded = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    except yaml.YAMLError:
        backup = config_path.with_name(f"{config_path.name}.bak-{int(time.time())}")
        config_path.rename(backup)
        return {}

    return loaded if isinstance(loaded, dict) else {}


def _dump_config(config: dict[str, Any]) -> str:
    def _represent_str(dumper: yaml.SafeDumper, data: str) -> yaml.nodes.ScalarNode:
        style = "|" if "\n" in data else None
        return dumper.represent_scalar("tag:yaml.org,2002:str", data, style=style)

    SafeDumper = yaml.SafeDumper
    SafeDumper.add_representer(str, _represent_str)
    return yaml.dump(config, Dumper=SafeDumper, sort_keys=False, allow_unicode=True)


def ensure_verxio_agent_defaults(hermes_home: Path) -> None:
    """Idempotently seed Verxio voice rules, empty WhatsApp prefix, and SOUL.md."""
    hermes_home.mkdir(parents=True, exist_ok=True)

    soul_path = hermes_home / "SOUL.md"
    if not soul_path.exists():
        soul_path.write_text(VERXIO_SOUL_MD, encoding="utf-8")
    else:
        current = soul_path.read_text(encoding="utf-8")
        if "Voice and formatting" not in current:
            soul_path.write_text(
                current.rstrip()
                + "\n\n"
                + "\n".join(VERXIO_SOUL_MD.splitlines()[8:]),
                encoding="utf-8",
            )

    config_path = hermes_home / "config.yaml"
    config = _load_config(config_path)

    agent = config.get("agent")
    if not isinstance(agent, dict):
        agent = {}
    existing_prompt = str(agent.get("system_prompt") or "")
    if VERXIO_VOICE_MARKER not in existing_prompt:
        agent["system_prompt"] = _join_prompt_parts(existing_prompt, VERXIO_SYSTEM_PROMPT)
    config["agent"] = agent

    whatsapp = config.get("whatsapp")
    if not isinstance(whatsapp, dict):
        whatsapp = {}
    whatsapp["reply_prefix"] = ""
    config["whatsapp"] = whatsapp

    config_path.write_text(_dump_config(config), encoding="utf-8")
