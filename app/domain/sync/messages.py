"""Wire-format envelopes shared by `/api/sync` and `/ws/events`."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from ..events.model import Event


@dataclass(slots=True)
class PresenceUpdate:
    user_id: str
    status: Literal["active", "away", "dnd", "offline"]
    set_at_ms: int


@dataclass(slots=True)
class TypingUpdate:
    channel_id: str
    user_id: str
    expires_at_ms: int


@dataclass(slots=True)
class ControlFrame:
    kind: Literal["ping", "pong", "force-resync", "error"]
    detail: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class SyncMessage:
    type: Literal["event", "presence", "typing", "control"]
    workspace_id: str
    cursor: str
    events: list[Event] = field(default_factory=list)
    presence: list[PresenceUpdate] = field(default_factory=list)
    typing: list[TypingUpdate] = field(default_factory=list)
    control: ControlFrame | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {
            "type": self.type,
            "workspace_id": self.workspace_id,
            "cursor": self.cursor,
        }
        if self.events:
            out["events"] = [e.to_dict() for e in self.events]
        if self.presence:
            out["presence"] = [
                {"user_id": p.user_id, "status": p.status, "set_at_ms": p.set_at_ms}
                for p in self.presence
            ]
        if self.typing:
            out["typing"] = [
                {
                    "channel_id": t.channel_id,
                    "user_id": t.user_id,
                    "expires_at_ms": t.expires_at_ms,
                }
                for t in self.typing
            ]
        if self.control is not None:
            out["control"] = {"kind": self.control.kind, "detail": self.control.detail}
        return out
