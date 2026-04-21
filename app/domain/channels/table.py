"""Projection tables for channels and channel members."""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger, UniqueConstraint


class Channel(Table):
    __tablename__ = "channels"

    channel_id = Column(types.Text, required=True, unique=True)
    workspace_id = Column(types.Text, required=True, index=True)
    name = Column(types.Text, required=True)
    type = Column(types.String, required=True, default="public")
    private = Column(types.Boolean, required=True, default=False)
    topic = Column(types.Text, nullable=True)
    description = Column(types.Text, nullable=True)
    staging_policy = Column(types.String, required=True, default="agent-messages-require-approval")
    slow_mode_seconds = Column(types.Integer, required=True, default=0)
    archived = Column(types.Boolean, required=True, default=False)
    created_at = Column(BigInteger, required=True)
    created_by = Column(types.Text, required=True)


class ChannelMember(Table):
    __tablename__ = "channel_members"
    __table_args__ = (
        UniqueConstraint("channel_id", "user_id", name="ux_channel_members_cid_uid"),
    )

    channel_id = Column(types.Text, required=True, index=True)
    user_id = Column(types.Text, required=True, index=True)
    joined_at = Column(BigInteger, required=True)
    role = Column(types.String, default="member")
