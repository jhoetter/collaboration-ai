"""Shared runtime — the command bus singleton bound to a real committer.

Lazy initialisation so unit tests under ``app/tests/`` never trigger a
hof-engine import. Production callers acquire the bus once on app
startup via ``get_command_bus()``.
"""

from __future__ import annotations

from contextlib import contextmanager
from functools import lru_cache
from typing import Iterator

from sqlalchemy.orm import Session

from ..events.projector import ProjectedState, project_event
from .command_bus import CommandBus, Committer
from .handlers import register_default_handlers


@lru_cache(maxsize=1)
def get_command_bus() -> CommandBus:
    from hof.db.engine import get_session_factory  # noqa: WPS433

    from ..events.repository import PostgresCommitter, stream_events

    session_factory = get_session_factory()

    state = ProjectedState()
    # Warm the in-memory state from the event log so authorisation
    # checks (workspace membership, channel ACLs, …) survive process
    # restarts. Single-process dev only — multi-worker deployments need
    # the Celery projector worker.
    try:
        with session_factory() as session:
            for workspace_id in _list_workspace_ids(session):
                for event in stream_events(
                    session,
                    workspace_id=workspace_id,
                    since_sequence=0,
                    limit=10_000_000,
                ):
                    project_event(state, event)
    except Exception:  # noqa: BLE001 — first-boot tables may not exist yet
        state = ProjectedState()

    bus = CommandBus(projector_state=state)
    register_default_handlers(bus)
    bus.committer = Committer(commit=PostgresCommitter(session_factory).commit)
    return bus


def _list_workspace_ids(session) -> list[str]:  # type: ignore[no-untyped-def]
    from sqlalchemy import text

    rows = session.execute(text("SELECT DISTINCT workspace_id FROM events")).fetchall()
    return [row[0] for row in rows]


def reset_command_bus_for_tests() -> None:
    """Used by integration tests that swap the committer."""
    get_command_bus.cache_clear()


def get_projected_state() -> ProjectedState:
    """Return the running in-memory projection state owned by the bus.

    Read-side endpoints (e.g. `chat:list-stars`,
    `chat:list-notification-prefs`) use this so they don't have to query
    SQL for derived state we already maintain in-process. Falls back to
    a fresh state if the bus hasn't been initialised yet.
    """
    bus = get_command_bus()
    return bus.projector_state or ProjectedState()


def get_session_factory():
    """Re-exports the hof-engine SQLAlchemy session factory.

    Kept in this module so read endpoints in
    `app/domain/events/functions.py` don't have to import hof inline.
    """
    from hof.db.engine import get_session_factory as _get  # noqa: WPS433

    return _get()


@contextmanager
def open_session() -> Iterator[Session]:
    """Open a managed SQLAlchemy session for ad-hoc reads/writes.

    hof-engine's `@function` HTTP layer treats every decorator parameter
    as a request body field — it does **not** inject a SQLAlchemy
    `Session` like a typical FastAPI dependency. Endpoints that need DB
    access therefore acquire one via this helper instead of accepting a
    `session` keyword argument (which would otherwise blow up with a 422
    "Field required: session" before the function even runs).
    """
    factory = get_session_factory()
    session = factory()
    try:
        yield session
    finally:
        session.close()
