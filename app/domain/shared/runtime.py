"""Shared runtime — the command bus singleton bound to a real committer.

Lazy initialisation so unit tests under ``app/tests/`` never trigger a
hof-engine import. Production callers acquire the bus once on app
startup via ``get_command_bus()``.
"""

from __future__ import annotations

from functools import lru_cache

from .command_bus import CommandBus, Committer
from .handlers import register_default_handlers


@lru_cache(maxsize=1)
def get_command_bus() -> CommandBus:
    from hof import get_session_factory  # noqa: WPS433

    from ..events.repository import PostgresCommitter

    bus = CommandBus()
    register_default_handlers(bus)
    bus.committer = Committer(commit=PostgresCommitter(get_session_factory()).commit)
    return bus


def reset_command_bus_for_tests() -> None:
    """Used by integration tests that swap the committer."""
    get_command_bus.cache_clear()


def get_session_factory():
    """Re-exports the hof-engine SQLAlchemy session factory.

    Kept in this module so read endpoints in
    `app/domain/events/functions.py` don't have to import hof inline.
    """
    from hof import get_session_factory as _get  # noqa: WPS433

    return _get()
