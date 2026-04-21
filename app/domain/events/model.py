"""Event envelope + the canonical event type set.

Mirrors the ``Event<T, C>`` shape from prompt.md (lines 406-424). All
events flow through a single ``Event`` dataclass; per-type payloads are
plain dicts validated by Pydantic models in
``domain/events/payloads.py``. We keep the envelope dataclass-only (no
runtime hof-engine import) so unit tests can exercise the projector
purely in Python.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

SenderType = Literal["human", "agent", "system"]

EventType = Literal[
    # Workspace
    "workspace.create",
    "workspace.update",
    "workspace.member.add",
    "workspace.member.remove",
    "workspace.member.role-set",
    # Channels
    "channel.create",
    "channel.update",
    "channel.archive",
    "channel.unarchive",
    "channel.member.join",
    "channel.member.leave",
    "channel.member.invite",
    "channel.member.kick",
    "channel.pin.add",
    "channel.pin.remove",
    "channel.topic.set",
    # Messages
    "message.send",
    "message.edit",
    "message.redact",
    # Reactions
    "reaction.add",
    "reaction.remove",
    # Read markers
    "read.marker",
    # Drafts (server-persisted)
    "draft.set",
    "draft.clear",
    # User meta
    "user.status.set",
    "user.presence.set",
    "user.snooze.set",
    # Agent / staging
    "agent.identity.register",
    "agent.proposal.create",
    "agent.proposal.approve",
    "agent.proposal.reject",
    "agent.proposal.edit-and-approve",
    # DMs
    "dm.create",
    # Scheduled messages + reminders
    "message.scheduled.set",
    "message.scheduled.cancel",
    "message.scheduled.fired",
    "message.reminder.set",
    "message.reminder.cancel",
    "message.reminder.fired",
    # Notifications
    "notification.create",
    "notification.read",
    # Bridges
    "bridge.import.message",
]

EVENT_TYPES: frozenset[str] = frozenset(
    [
        "workspace.create",
        "workspace.update",
        "workspace.member.add",
        "workspace.member.remove",
        "workspace.member.role-set",
        "channel.create",
        "channel.update",
        "channel.archive",
        "channel.unarchive",
        "channel.member.join",
        "channel.member.leave",
        "channel.member.invite",
        "channel.member.kick",
        "channel.pin.add",
        "channel.pin.remove",
        "channel.topic.set",
        "message.send",
        "message.edit",
        "message.redact",
        "reaction.add",
        "reaction.remove",
        "read.marker",
        "draft.set",
        "draft.clear",
        "user.status.set",
        "user.presence.set",
        "user.snooze.set",
        "agent.identity.register",
        "agent.proposal.create",
        "agent.proposal.approve",
        "agent.proposal.reject",
        "agent.proposal.edit-and-approve",
        "dm.create",
        "message.scheduled.set",
        "message.scheduled.cancel",
        "message.scheduled.fired",
        "message.reminder.set",
        "message.reminder.cancel",
        "message.reminder.fired",
        "notification.create",
        "notification.read",
        "bridge.import.message",
    ]
)


def is_known_event_type(value: str) -> bool:
    """Cheap, dependency-free check used by the projector dispatcher."""
    return value in EVENT_TYPES


@dataclass(slots=True, frozen=True)
class RelatesTo:
    """Reference to a prior event for edits / reactions / threads / redactions."""

    event_id: str
    rel_type: Literal["m.replace", "m.reaction", "m.thread", "m.redact"]


@dataclass(slots=True)
class Event:
    """The canonical event envelope appended to the log.

    ``sequence`` is assigned by the server at commit time; ``origin_ts``
    is the server-side wall clock at commit. Both are `int` (millis /
    monotonic int) so projection logic stays cheap and total-orderable.
    """

    event_id: str
    type: EventType
    content: dict[str, Any]
    workspace_id: str
    room_id: str
    sender_id: str
    sender_type: SenderType
    origin_ts: int
    sequence: int
    agent_id: str | None = None
    relates_to: RelatesTo | None = None
    idempotency_key: str | None = None
    # Free-form ingest provenance (used by Phase 6 bridges so an imported
    # Slack message can carry the original timestamp + author label).
    origin: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        """JSON-friendly serialisation. Used by the wire protocol + fixtures."""
        out: dict[str, Any] = {
            "event_id": self.event_id,
            "type": self.type,
            "content": self.content,
            "workspace_id": self.workspace_id,
            "room_id": self.room_id,
            "sender_id": self.sender_id,
            "sender_type": self.sender_type,
            "origin_ts": self.origin_ts,
            "sequence": self.sequence,
        }
        if self.agent_id is not None:
            out["agent_id"] = self.agent_id
        if self.relates_to is not None:
            out["relates_to"] = {
                "event_id": self.relates_to.event_id,
                "rel_type": self.relates_to.rel_type,
            }
        if self.idempotency_key is not None:
            out["idempotency_key"] = self.idempotency_key
        if self.origin is not None:
            out["origin"] = self.origin
        return out

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Event:
        rt = data.get("relates_to")
        return cls(
            event_id=data["event_id"],
            type=data["type"],
            content=data["content"],
            workspace_id=data["workspace_id"],
            room_id=data["room_id"],
            sender_id=data["sender_id"],
            sender_type=data["sender_type"],
            origin_ts=int(data["origin_ts"]),
            sequence=int(data["sequence"]),
            agent_id=data.get("agent_id"),
            relates_to=RelatesTo(event_id=rt["event_id"], rel_type=rt["rel_type"]) if rt else None,
            idempotency_key=data.get("idempotency_key"),
            origin=data.get("origin"),
        )


@dataclass(slots=True)
class EventEnvelope:
    """A pre-commit envelope: the event without its server-assigned sequence.

    Returned from the command bus' ``build_events`` step before the
    repository assigns a per-workspace monotonic ``sequence``.
    """

    event_id: str
    type: EventType
    content: dict[str, Any]
    workspace_id: str
    room_id: str
    sender_id: str
    sender_type: SenderType
    agent_id: str | None = None
    relates_to: RelatesTo | None = None
    idempotency_key: str | None = None
    origin: dict[str, Any] | None = None
    extra: dict[str, Any] = field(default_factory=dict)
