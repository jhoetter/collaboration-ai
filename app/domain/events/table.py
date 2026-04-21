"""hof-engine Table definition for the events log.

This module is the **only** place the events table touches hof-engine
primitives; the projection logic in ``projector.py`` stays pure Python
so it can run under unit tests without a hof-engine install.

The actual partitioning (`PARTITION BY LIST (workspace_id)`) and
indexes are managed by Alembic migrations under ``app/migrations/``.
hof-engine's ``Table`` is used here for the column definitions and for
the auto-generated CRUD endpoints (`events.list`, `events.get`) that
the admin UI consumes.
"""

from __future__ import annotations

from hof import Column, Table, types


class EventRow(Table):
    """One row per committed event. Append-only.

    The composite primary key ``(workspace_id, sequence)`` matches the
    physical partition key; ``event_id`` carries the secondary unique
    constraint so the committer can detect idempotent retries.
    """

    __tablename__ = "events"

    workspace_id = Column(types.Text, required=True, primary_key=True)
    sequence = Column(types.BigInteger, required=True, primary_key=True)

    event_id = Column(types.Text, required=True, unique=True)
    type = Column(types.Text, required=True)
    content = Column(types.JSON, required=True)
    room_id = Column(types.Text, required=True)
    sender_id = Column(types.Text, required=True)
    sender_type = Column(types.String, required=True)
    agent_id = Column(types.Text, nullable=True)
    origin_ts = Column(types.BigInteger, required=True)

    relates_to_id = Column(types.Text, nullable=True)
    relates_to_rel = Column(types.String, nullable=True)

    idempotency_key = Column(types.Text, nullable=True)
    origin = Column(types.JSON, nullable=True)


class WorkspaceSequence(Table):
    """The per-workspace monotonic counter consulted by the committer."""

    __tablename__ = "workspace_sequence"

    workspace_id = Column(types.Text, required=True, primary_key=True)
    seq = Column(types.BigInteger, required=True, default=0)
