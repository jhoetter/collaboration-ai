"""Projection tables for messages, reactions, read markers, pins, drafts."""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger, UniqueConstraint


class Message(Table):
    __tablename__ = "messages"

    message_id = Column(types.Text, required=True, unique=True)
    workspace_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, required=True, index=True)
    thread_root = Column(types.Text, nullable=True, index=True)
    sender_id = Column(types.Text, required=True)
    sender_type = Column(types.String, required=True)
    agent_id = Column(types.Text, nullable=True)
    content = Column(types.Text, required=True, default="")
    mentions = Column(types.JSON, required=True, default=list)
    attachments = Column(types.JSON, required=True, default=list)
    edited_at = Column(BigInteger, nullable=True)
    redacted = Column(types.Boolean, required=True, default=False)
    redact_reason = Column(types.Text, nullable=True)
    sequence = Column(BigInteger, required=True, index=True)
    created_at = Column(BigInteger, required=True)
    imported_from = Column(types.Text, nullable=True)
    original_author = Column(types.Text, nullable=True)


class Reaction(Table):
    __tablename__ = "reactions"
    __table_args__ = (
        UniqueConstraint("message_id", "emoji", "user_id", name="ux_reactions_mid_emoji_uid"),
    )

    message_id = Column(types.Text, required=True, index=True)
    emoji = Column(types.Text, required=True)
    user_id = Column(types.Text, required=True)
    added_at = Column(BigInteger, required=True)


class ReadMarker(Table):
    __tablename__ = "read_markers"
    __table_args__ = (
        UniqueConstraint("user_id", "channel_id", name="ux_read_markers_uid_cid"),
    )

    user_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, required=True, index=True)
    up_to_sequence = Column(BigInteger, required=True)


class Pinned(Table):
    __tablename__ = "pinned"
    __table_args__ = (
        UniqueConstraint("channel_id", "message_id", name="ux_pinned_cid_mid"),
    )

    channel_id = Column(types.Text, required=True, index=True)
    message_id = Column(types.Text, required=True)
    pinned_at = Column(BigInteger, required=True)
    pinned_by = Column(types.Text, required=True)


class Draft(Table):
    __tablename__ = "drafts"
    __table_args__ = (
        UniqueConstraint("user_id", "channel_id", name="ux_drafts_uid_cid"),
    )

    user_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, required=True, index=True)
    thread_root = Column(types.Text, nullable=True)
    content = Column(types.Text, required=True)
    updated_at = Column(BigInteger, required=True)
