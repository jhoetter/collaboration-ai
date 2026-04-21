"""Pydantic payload schemas keyed by event type.

The command bus uses these to validate ``Command.payload`` *before*
producing events. Once an event is in the log, payloads are stored as
plain JSON; we re-validate on read only when a new caller binds the dict
back into a typed shape.
"""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


class _StrictModel(BaseModel):
    """Reject unknown keys so typo'd payloads don't silently no-op."""

    model_config = {"extra": "forbid"}


# ---------------------------------------------------------------------------
# Workspace
# ---------------------------------------------------------------------------


class WorkspaceCreate(_StrictModel):
    name: str
    slug: str | None = None
    icon: str | None = None


class WorkspaceUpdate(_StrictModel):
    name: str | None = None
    slug: str | None = None
    icon: str | None = None


class WorkspaceMemberAdd(_StrictModel):
    user_id: str
    role: Literal["owner", "admin", "member", "guest"] = "member"


class WorkspaceMemberRemove(_StrictModel):
    user_id: str


class WorkspaceMemberRoleSet(_StrictModel):
    user_id: str
    role: Literal["owner", "admin", "member", "guest"]


# ---------------------------------------------------------------------------
# Channels
# ---------------------------------------------------------------------------


ChannelType = Literal["public", "private", "dm", "group_dm"]
StagingPolicy = Literal[
    "all-require-approval",
    "agent-messages-require-approval",
    "auto-send-with-badge",
    "fully-autonomous",
]


class ChannelCreate(_StrictModel):
    name: str
    type: ChannelType = "public"
    private: bool = False
    topic: str | None = None
    description: str | None = None
    staging_policy: StagingPolicy = "agent-messages-require-approval"
    slow_mode_seconds: int = 0
    member_ids: list[str] = Field(default_factory=list)

    @field_validator("name")
    @classmethod
    def _normalise_name(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("channel name must be non-empty")
        if len(v) > 80:
            raise ValueError("channel name must be ≤80 chars")
        return v


class ChannelUpdate(_StrictModel):
    name: str | None = None
    topic: str | None = None
    description: str | None = None
    staging_policy: StagingPolicy | None = None
    slow_mode_seconds: int | None = None


class ChannelInvite(_StrictModel):
    user_ids: list[str] = Field(min_length=1)


class ChannelKick(_StrictModel):
    user_id: str
    reason: str | None = None


class ChannelTopicSet(_StrictModel):
    topic: str | None = None


class ChannelPin(_StrictModel):
    message_id: str


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


class Attachment(_StrictModel):
    file_id: str
    name: str
    mime: str
    size_bytes: int
    width: int | None = None
    height: int | None = None
    thumbnail_url: str | None = None


class MessageSend(_StrictModel):
    content: str
    thread_root: str | None = None
    mentions: list[str] = Field(default_factory=list)
    mentions_special: list[Literal["@channel", "@here"]] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)

    @field_validator("content")
    @classmethod
    def _length(cls, v: str) -> str:
        # Allow empty content if attachments are present (validated at command level).
        if len(v) > 8_000:
            raise ValueError("message content exceeds 8 000 char limit")
        return v


class MessageEdit(_StrictModel):
    new_content: str
    mentions: list[str] | None = None


class MessageRedact(_StrictModel):
    reason: str | None = None


class ReactionAddRemove(_StrictModel):
    emoji: str

    @field_validator("emoji")
    @classmethod
    def _short(cls, v: str) -> str:
        if not v or len(v) > 64:
            raise ValueError("emoji shortcode must be 1-64 chars")
        return v


class ReadMarker(_StrictModel):
    up_to_event_id: str


# ---------------------------------------------------------------------------
# Drafts / user meta
# ---------------------------------------------------------------------------


class DraftSet(_StrictModel):
    content: str
    thread_root: str | None = None


class UserStatusSet(_StrictModel):
    emoji: str | None = None
    text: str | None = None
    clear_at: int | None = None


class UserPresenceSet(_StrictModel):
    status: Literal["active", "away", "dnd"]
    until: int | None = None


class UserSnoozeSet(_StrictModel):
    until: int | None = None


# ---------------------------------------------------------------------------
# Agents / staging
# ---------------------------------------------------------------------------


class AgentRegister(_StrictModel):
    agent_id: str
    display_name: str
    scopes: list[str] = Field(default_factory=list)


class AgentProposeMessage(_StrictModel):
    channel_id: str
    content: str
    rationale: str | None = None
    thread_root: str | None = None
    mentions: list[str] = Field(default_factory=list)
    attachments: list[Attachment] = Field(default_factory=list)


class ProposalDecision(_StrictModel):
    proposal_id: str
    reason: str | None = None
    edited_payload: dict[str, Any] | None = None


# ---------------------------------------------------------------------------
# Lookup table
# ---------------------------------------------------------------------------


PAYLOAD_SCHEMAS: dict[str, type[_StrictModel]] = {
    "workspace.create": WorkspaceCreate,
    "workspace.update": WorkspaceUpdate,
    "workspace.member.add": WorkspaceMemberAdd,
    "workspace.member.remove": WorkspaceMemberRemove,
    "workspace.member.role-set": WorkspaceMemberRoleSet,
    "channel.create": ChannelCreate,
    "channel.update": ChannelUpdate,
    "channel.member.invite": ChannelInvite,
    "channel.member.kick": ChannelKick,
    "channel.topic.set": ChannelTopicSet,
    "channel.pin.add": ChannelPin,
    "channel.pin.remove": ChannelPin,
    "message.send": MessageSend,
    "message.edit": MessageEdit,
    "message.redact": MessageRedact,
    "reaction.add": ReactionAddRemove,
    "reaction.remove": ReactionAddRemove,
    "read.marker": ReadMarker,
    "draft.set": DraftSet,
    "user.status.set": UserStatusSet,
    "user.presence.set": UserPresenceSet,
    "user.snooze.set": UserSnoozeSet,
    "agent.identity.register": AgentRegister,
    "agent.proposal.create": AgentProposeMessage,
    "agent.proposal.approve": ProposalDecision,
    "agent.proposal.reject": ProposalDecision,
    "agent.proposal.edit-and-approve": ProposalDecision,
}


def validate_payload(event_type: str, raw: dict[str, Any]) -> dict[str, Any]:
    """Validate ``raw`` against the schema for ``event_type`` and return a
    plain dict suitable for serialisation. Raises ``pydantic.ValidationError``
    on bad input. Event types without a schema are passed through.
    """
    schema = PAYLOAD_SCHEMAS.get(event_type)
    if schema is None:
        return raw
    return schema.model_validate(raw).model_dump(exclude_none=True)
