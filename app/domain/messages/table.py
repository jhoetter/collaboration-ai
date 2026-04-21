"""Projection tables for messages, reactions, read markers, pins, drafts."""

from __future__ import annotations

from hof import Column, Table, types


class Message(Table):
    __tablename__ = "messages"

    message_id = Column(types.Text, required=True, primary_key=True)
    workspace_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, required=True, index=True)
    thread_root = Column(types.Text, nullable=True, index=True)
    sender_id = Column(types.Text, required=True)
    sender_type = Column(types.String, required=True)
    agent_id = Column(types.Text, nullable=True)
    content = Column(types.Text, required=True, default="")
    mentions = Column(types.JSON, required=True, default=list)
    attachments = Column(types.JSON, required=True, default=list)
    edited_at = Column(types.BigInteger, nullable=True)
    redacted = Column(types.Boolean, required=True, default=False)
    redact_reason = Column(types.Text, nullable=True)
    sequence = Column(types.BigInteger, required=True, index=True)
    created_at = Column(types.BigInteger, required=True)
    imported_from = Column(types.Text, nullable=True)
    original_author = Column(types.Text, nullable=True)


class Reaction(Table):
    __tablename__ = "reactions"

    message_id = Column(types.Text, required=True, primary_key=True)
    emoji = Column(types.Text, required=True, primary_key=True)
    user_id = Column(types.Text, required=True, primary_key=True)
    added_at = Column(types.BigInteger, required=True)


class ReadMarker(Table):
    __tablename__ = "read_markers"

    user_id = Column(types.Text, required=True, primary_key=True)
    channel_id = Column(types.Text, required=True, primary_key=True)
    up_to_sequence = Column(types.BigInteger, required=True)


class Pinned(Table):
    __tablename__ = "pinned"

    channel_id = Column(types.Text, required=True, primary_key=True)
    message_id = Column(types.Text, required=True, primary_key=True)
    pinned_at = Column(types.BigInteger, required=True)
    pinned_by = Column(types.Text, required=True)


class Draft(Table):
    __tablename__ = "drafts"

    user_id = Column(types.Text, required=True, primary_key=True)
    channel_id = Column(types.Text, required=True, primary_key=True)
    thread_root = Column(types.Text, nullable=True)
    content = Column(types.Text, required=True)
    updated_at = Column(types.BigInteger, required=True)
