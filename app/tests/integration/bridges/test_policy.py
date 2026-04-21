from __future__ import annotations

from domain.bridges.policy import is_bridge_enabled


def test_disabled_by_default() -> None:
    assert is_bridge_enabled({}, "slack") is False
    assert is_bridge_enabled({"bridges": {}}, "matrix") is False


def test_enabled_when_workspace_opts_in() -> None:
    settings = {"bridges": {"slack": True, "matrix": False}}
    assert is_bridge_enabled(settings, "slack") is True
    assert is_bridge_enabled(settings, "matrix") is False


def test_unknown_bridges_value_is_false() -> None:
    assert is_bridge_enabled({"bridges": "yes"}, "slack") is False
