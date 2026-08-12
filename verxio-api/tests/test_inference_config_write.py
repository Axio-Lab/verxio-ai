from pathlib import Path

import yaml

from app.inference import _write_runtime_config
from app.models import RuntimeInstance


def _runtime(hermes_home: Path) -> RuntimeInstance:
    return RuntimeInstance(
        id="rt_test",
        tenant_id="ten",
        workspace_id="ws",
        agent_id="ag",
        mode="hosted",
        status="running",
        hermes_home_path=str(hermes_home),
        workspace_path=str(hermes_home / "workspace"),
        artifact_path=str(hermes_home / "artifacts"),
    )


def test_write_runtime_config_preserves_media_pins(tmp_path: Path) -> None:
    hermes_home = tmp_path / "hermes-home"
    hermes_home.mkdir(parents=True)
    (hermes_home / "config.yaml").write_text(
        yaml.safe_dump(
            {
                "image_gen": {"provider": "openai", "model": "gpt-image-2-medium"},
                "video_gen": {"provider": "dashscope", "model": "happyhorse-1.1"},
                "model": {"provider": "alibaba", "default": "qwen3.6-plus"},
                "terminal": {"backend": "local"},
            }
        ),
        encoding="utf-8",
    )

    # Simulate a raced/partial in-memory config that only carries the model pin.
    _write_runtime_config(
        _runtime(hermes_home),
        {"model": {"provider": "gemini", "default": "gemini-flash-lite-latest"}},
    )

    loaded = yaml.safe_load((hermes_home / "config.yaml").read_text(encoding="utf-8"))
    assert loaded["model"]["provider"] == "gemini"
    assert loaded["image_gen"]["provider"] == "openai"
    assert loaded["video_gen"]["model"] == "happyhorse-1.1"
    assert loaded["terminal"]["backend"] == "local"
