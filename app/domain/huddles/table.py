"""Huddle projection tables.

A huddle is a lightweight realtime room scoped to a channel. The event
log is the source of truth (`huddle.start` / `huddle.join` /
`huddle.leave` / `huddle.end`); these tables let the UI list active
huddles without replaying the log.
"""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger, UniqueConstraint


class Huddle(Table):
    __tablename__ = "huddles"

    huddle_id = Column(types.Text, required=True, unique=True)
    workspace_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, required=True, index=True)
    livekit_room = Column(types.Text, required=True)
    started_by = Column(types.Text, required=True)
    started_at = Column(BigInteger, required=True)
    ended_at = Column(BigInteger, nullable=True)
    title = Column(types.Text, nullable=True)


class HuddleParticipant(Table):
    __tablename__ = "huddle_participants"
    __table_args__ = (
        UniqueConstraint("huddle_id", "user_id", name="ux_huddle_participants_hid_uid"),
    )

    huddle_id = Column(types.Text, required=True, index=True)
    user_id = Column(types.Text, required=True)
    joined_at = Column(BigInteger, required=True)
    left_at = Column(BigInteger, nullable=True)
    role = Column(types.String, required=True, default="guest")
