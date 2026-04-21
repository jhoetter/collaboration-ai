"""Projection tables for channels and channel members."""

from __future__ import annotations

from hof import Column, Table, types


class Channel(Table):
    __tablename__ = "channels"

    channel_id = Column(types.Text, required=True, primary_key=True)
    workspace_id = Column(types.Text, required=True, index=True)
    name = Column(types.Text, required=True)
    type = Column(types.String, required=True, default="public")
    private = Column(types.Boolean, required=True, default=False)
    topic = Column(types.Text, nullable=True)
    description = Column(types.Text, nullable=True)
    staging_policy = Column(types.String, required=True, default="agent-messages-require-approval")
    slow_mode_seconds = Column(types.Integer, required=True, default=0)
    archived = Column(types.Boolean, required=True, default=False)
    created_at = Column(types.BigInteger, required=True)
    created_by = Column(types.Text, required=True)


class ChannelMember(Table):
    __tablename__ = "channel_members"

    channel_id = Column(types.Text, required=True, primary_key=True)
    user_id = Column(types.Text, required=True, primary_key=True)
    joined_at = Column(types.BigInteger, required=True)
    role = Column(types.String, default="member")
