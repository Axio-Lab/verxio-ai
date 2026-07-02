from pathlib import Path

from app.verxio_agent_defaults import VERXIO_VOICE_MARKER, ensure_verxio_agent_defaults


def test_ensure_verxio_agent_defaults_is_idempotent(tmp_path: Path) -> None:
    hermes_home = tmp_path / "hermes-home"
    ensure_verxio_agent_defaults(hermes_home)

    soul = (hermes_home / "SOUL.md").read_text(encoding="utf-8")
    config_text = (hermes_home / "config.yaml").read_text(encoding="utf-8")

    assert "Voice and formatting" in soul
    assert VERXIO_VOICE_MARKER in config_text
    assert 'reply_prefix: ""' in config_text or "reply_prefix: ''" in config_text

    ensure_verxio_agent_defaults(hermes_home)
    assert config_text == (hermes_home / "config.yaml").read_text(encoding="utf-8")
