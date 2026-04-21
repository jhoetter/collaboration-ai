"""Notifications projection table.

Mirrors the in-memory `ProjectedState.notifications` map but survives
restarts and lets the UI paginate older mentions without replaying the
full event log.
"""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger


class Notification(Table):
    __tablename__ = "notifications"

    notification_id = Column(types.Text, required=True, unique=True)
    user_id = Column(types.Text, required=True, index=True)
    workspace_id = Column(types.Text, required=True, index=True)
    channel_id = Column(types.Text, nullable=True)
    kind = Column(types.String, required=True)
    target_event_id = Column(types.Text, nullable=True)
    body = Column(types.Text, nullable=True)
    created_at = Column(BigInteger, required=True)
    read_at = Column(BigInteger, nullable=True)
