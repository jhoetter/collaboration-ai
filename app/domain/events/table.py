"""hof-engine Table definition for the events log.

This module is the **only** place the events table touches hof-engine
primitives; the projection logic in ``projector.py`` stays pure Python
so it can run under unit tests without a hof-engine install.

The actual partitioning (`PARTITION BY LIST (workspace_id)`) and
indexes are managed by Alembic migrations under ``app/migrations/``.
hof-engine's ``Table`` is used here for the column definitions and for
the auto-generated CRUD endpoints (`events.list`, `events.get`) that
the admin UI consumes.

We can't use ``primary_key=True`` for the natural keys since hof's
``Table`` always injects its own ``id`` UUID PK; we add a
``UniqueConstraint`` instead to enforce ``(workspace_id, sequence)``
uniqueness, which is what the committer relies on for ordering and
idempotent retries.
"""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger, UniqueConstraint


class EventRow(Table):
    """One row per committed event. Append-only."""

    __tablename__ = "events"
    __table_args__ = (
        UniqueConstraint("workspace_id", "sequence", name="ux_events_workspace_seq"),
    )

    workspace_id = Column(types.Text, required=True, index=True)
    sequence = Column(BigInteger, required=True, index=True)

    event_id = Column(types.Text, required=True, unique=True)
    type = Column(types.Text, required=True)
    content = Column(types.JSON, required=True)
    room_id = Column(types.Text, required=True)
    sender_id = Column(types.Text, required=True)
    sender_type = Column(types.String, required=True)
    agent_id = Column(types.Text, nullable=True)
    origin_ts = Column(BigInteger, required=True)

    relates_to_id = Column(types.Text, nullable=True)
    relates_to_rel = Column(types.String, nullable=True)

    idempotency_key = Column(types.Text, nullable=True)
    origin = Column(types.JSON, nullable=True)


class WorkspaceSequence(Table):
    """The per-workspace monotonic counter consulted by the committer."""

    __tablename__ = "workspace_sequence"

    workspace_id = Column(types.Text, required=True, unique=True)
    seq = Column(BigInteger, required=True, default=0)
