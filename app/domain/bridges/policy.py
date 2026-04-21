from __future__ import annotations

from typing import Mapping

from .protocol import Provider


def is_bridge_enabled(
    workspace_settings: Mapping[str, object], provider: Provider
) -> bool:
    """Read the workspace projection's `bridges` map.

    Bridges default to disabled. Admins flip them on via a
    `workspace.bridges` event from the settings UI; the projector
    surfaces that under `workspace.settings["bridges"][provider]`.
    """
    bridges = workspace_settings.get("bridges")
    if not isinstance(bridges, Mapping):
        return False
    value = bridges.get(provider)
    return bool(value)
