from pathlib import Path

import yaml

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


def test_ensure_verxio_agent_defaults_repairs_corrupt_config(tmp_path: Path) -> None:
    hermes_home = tmp_path / "hermes-home"
    hermes_home.mkdir(parents=True)
    (hermes_home / "config.yaml").write_text(
        "\n".join(
            [
                "whatsapp:",
                "  reply_prefix: ''",
                "    - Sound natural and human, like a capable person texting.",
                "",
            ]
        ),
        encoding="utf-8",
    )

    ensure_verxio_agent_defaults(hermes_home)

    backups = list(hermes_home.glob("config.yaml.bak-*"))
    assert len(backups) == 1

    loaded = yaml.safe_load((hermes_home / "config.yaml").read_text(encoding="utf-8"))
    assert isinstance(loaded, dict)
    assert VERXIO_VOICE_MARKER in str(loaded["agent"]["system_prompt"])
    assert loaded["whatsapp"]["reply_prefix"] == ""
