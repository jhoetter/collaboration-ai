from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

Provider = Literal["slack", "matrix"]


@dataclass(frozen=True)
class BridgeEvent:
    """Provider-neutral wire shape consumed by the importer.

    Both Slack and Matrix parsers normalise to this; downstream
    code never needs to branch on `provider` except for prefixing.
    """

    provider: Provider
    external_channel_id: str
    external_channel_name: str
    external_message_id: str
    external_user_id: str
    external_user_display: str
    external_ts: float
    text: str
    thread_root: str | None = None
    is_edit_of: str | None = None
    is_private: bool = False


def archive_channel_name(provider: Provider, external_channel_name: str) -> str:
    """Deterministic mapping from external name to local archive name."""
    return f"{provider}-archive/{external_channel_name}"


def bridge_agent_id(provider: Provider) -> str:
    """The synthetic identity used for budget + audit attribution."""
    return f"bridge:{provider}"
