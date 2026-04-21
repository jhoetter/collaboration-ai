"""Postgres-backed committer + log reader.

Wraps the pure ``Committer`` protocol from
``domain/shared/command_bus.py``. Imports hof-engine lazily so the unit
tests can substitute a stub committer without touching this module.
"""

from __future__ import annotations

from typing import Iterable

from .ids import now_ms
from .model import Event, EventEnvelope


class PostgresCommitter:
    """Append a list of envelopes to ``events`` in one transaction.

    Sequence numbers come from the per-workspace counter row taken FOR
    UPDATE inside the same transaction. Idempotency-key conflicts are
    resolved by returning the previously-committed event (so the
    caller's `CommandResult` still references a real Event).

    The actual SQL lives in ``commit()``; the inline doc gives the shape
    so reviewers don't have to hop between files.
    """

    def __init__(self, session_factory) -> None:  # type: ignore[no-untyped-def]
        self._session_factory = session_factory

    def commit(self, envelopes: list[EventEnvelope]) -> list[Event]:
        if not envelopes:
            return []
        # Group by workspace_id; each group needs its own counter lock.
        by_ws: dict[str, list[EventEnvelope]] = {}
        for env in envelopes:
            by_ws.setdefault(env.workspace_id, []).append(env)

        from .projection_writer import write_projection

        ts = now_ms()
        out: list[Event] = []
        with self._session_factory() as session:
            for ws_id, group in by_ws.items():
                base = self._take_sequence_block(session, ws_id, count=len(group))
                for offset, env in enumerate(group):
                    seq = base + offset + 1
                    row = self._insert_event(session, env, seq, ts)
                    out.append(row)
                    write_projection(session, row)
            session.commit()
        return out

    # ---- helpers --------------------------------------------------------

    def _take_sequence_block(self, session, workspace_id: str, *, count: int) -> int:  # type: ignore[no-untyped-def]
        """Reserve ``count`` consecutive sequence numbers for ``workspace_id``.

        Uses ``SELECT … FOR UPDATE`` followed by an UPDATE so two parallel
        commits serialise correctly without leaving gaps.
        """
        from sqlalchemy import text

        row = session.execute(
            text("SELECT seq FROM workspace_sequence WHERE workspace_id = :w FOR UPDATE"),
            {"w": workspace_id},
        ).first()
        base = int(row[0]) if row else 0
        if row is None:
            session.execute(
                text("INSERT INTO workspace_sequence (workspace_id, seq) VALUES (:w, :s)"),
                {"w": workspace_id, "s": count},
            )
        else:
            session.execute(
                text("UPDATE workspace_sequence SET seq = :s WHERE workspace_id = :w"),
                {"w": workspace_id, "s": base + count},
            )
        return base

    def _insert_event(self, session, env: EventEnvelope, sequence: int, ts: int) -> Event:  # type: ignore[no-untyped-def]
        from sqlalchemy import text
        from sqlalchemy.exc import IntegrityError

        params = {
            "workspace_id": env.workspace_id,
            "sequence": sequence,
            "event_id": env.event_id,
            "type": env.type,
            "content": env.content,
            "room_id": env.room_id,
            "sender_id": env.sender_id,
            "sender_type": env.sender_type,
            "agent_id": env.agent_id,
            "origin_ts": ts,
            "relates_to_id": env.relates_to.event_id if env.relates_to else None,
            "relates_to_rel": env.relates_to.rel_type if env.relates_to else None,
            "idempotency_key": env.idempotency_key,
            "origin": env.origin,
        }
        try:
            session.execute(
                text(
                    """
                    INSERT INTO events (workspace_id, sequence, event_id, type, content,
                                        room_id, sender_id, sender_type, agent_id,
                                        origin_ts, relates_to_id, relates_to_rel,
                                        idempotency_key, origin)
                    VALUES (:workspace_id, :sequence, :event_id, :type, :content,
                            :room_id, :sender_id, :sender_type, :agent_id,
                            :origin_ts, :relates_to_id, :relates_to_rel,
                            :idempotency_key, :origin)
                    """
                ),
                params,
            )
        except IntegrityError:
            # Idempotency-key conflict: fetch and return the prior event.
            existing = session.execute(
                text(
                    """
                    SELECT * FROM events
                    WHERE workspace_id = :w AND sender_id = :s AND idempotency_key = :ik
                    """
                ),
                {"w": env.workspace_id, "s": env.sender_id, "ik": env.idempotency_key},
            ).mappings().first()
            if existing is None:
                raise
            return _row_to_event(dict(existing))
        return Event(
            event_id=env.event_id,
            type=env.type,  # type: ignore[arg-type]
            content=env.content,
            workspace_id=env.workspace_id,
            room_id=env.room_id,
            sender_id=env.sender_id,
            sender_type=env.sender_type,
            origin_ts=ts,
            sequence=sequence,
            agent_id=env.agent_id,
            relates_to=env.relates_to,
            idempotency_key=env.idempotency_key,
            origin=env.origin,
        )


def _row_to_event(row: dict) -> Event:
    from .model import RelatesTo

    rt = (
        RelatesTo(event_id=row["relates_to_id"], rel_type=row["relates_to_rel"])
        if row.get("relates_to_id")
        else None
    )
    return Event(
        event_id=row["event_id"],
        type=row["type"],
        content=row["content"],
        workspace_id=row["workspace_id"],
        room_id=row["room_id"],
        sender_id=row["sender_id"],
        sender_type=row["sender_type"],
        origin_ts=int(row["origin_ts"]),
        sequence=int(row["sequence"]),
        agent_id=row.get("agent_id"),
        relates_to=rt,
        idempotency_key=row.get("idempotency_key"),
        origin=row.get("origin"),
    )


def stream_events(session, *, workspace_id: str, since_sequence: int, limit: int = 1_000) -> Iterable[Event]:  # type: ignore[no-untyped-def]
    """Yield events in sequence order, used by the sync engine + replay tool."""
    from sqlalchemy import text

    rows = session.execute(
        text(
            """
            SELECT * FROM events
            WHERE workspace_id = :w AND sequence > :s
            ORDER BY sequence
            LIMIT :n
            """
        ),
        {"w": workspace_id, "s": since_sequence, "n": limit},
    ).mappings()
    for r in rows:
        yield _row_to_event(dict(r))
