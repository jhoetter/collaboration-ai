"""``demo:onboard`` orchestration test (in-memory bus, stub session).

We bootstrap an in-memory ``CommandBus`` shaped like the production
runtime (``u_system`` owns ``w_demo`` and is a member of every default
channel), then call ``demo.functions.onboard`` with ``open_session``
monkeypatched to yield a stub session that mirrors the projection
table's "is this user already a member?" answer. The assertions cover
both the happy path (a brand-new anonymous user joins workspace + every
default channel) and idempotency (a returning user produces zero new
events).
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import pytest

from domain.demo.functions import (
    DEFAULT_CHANNEL_IDS,
    DEFAULT_LANDING_CHANNEL,
    DEMO_WORKSPACE_ID,
    SYSTEM_USER_ID,
    onboard,
)
from domain.events.projector import ProjectedState
from domain.shared.command_bus import Command, CommandBus
from domain.shared.handlers import register_default_handlers


@dataclass
class _Result:
    rows: list[tuple[Any, ...]]

    def first(self):
        return self.rows[0] if self.rows else None


@dataclass
class _StubSession:
    """Mirrors the projection state for membership lookups.

    Pre-loaded with the workspace + channel rows the seed would have
    inserted for ``u_system``. ``execute`` only handles the two SELECT
    shapes ``demo:onboard`` issues; the ``INSERT INTO users`` for the
    upsert returns nothing.
    """

    workspace_members: set[tuple[str, str]] = field(default_factory=set)
    channel_members: set[tuple[str, str]] = field(default_factory=set)
    upserts: list[dict[str, Any]] = field(default_factory=list)
    commits: int = 0

    def execute(self, statement, params: dict[str, Any] | None = None):  # noqa: ANN201
        sql = str(statement)
        params = params or {}
        if "FROM workspace_members" in sql:
            key = (params["w"], params["u"])
            return _Result(rows=[(1,)] if key in self.workspace_members else [])
        if "FROM channel_members" in sql:
            key = (params["c"], params["u"])
            return _Result(rows=[(1,)] if key in self.channel_members else [])
        if "INSERT INTO users" in sql:
            self.upserts.append(params)
            return _Result(rows=[])
        return _Result(rows=[])

    def commit(self) -> None:
        self.commits += 1


def _bootstrap_bus_with_demo_workspace(monkeypatch: pytest.MonkeyPatch) -> tuple[CommandBus, ProjectedState]:
    """Set up a bus + projected state matching what the seed would create."""
    state = ProjectedState()
    bus = register_default_handlers(CommandBus(projector_state=state))

    bus.dispatch(
        Command(
            type="workspace:create",
            payload={"name": "Demo"},
            source="human",
            actor_id=SYSTEM_USER_ID,
            workspace_id=DEMO_WORKSPACE_ID,
        )
    )
    for channel_id in DEFAULT_CHANNEL_IDS:
        bus.dispatch(
            Command(
                type="channel:create",
                payload={"name": channel_id, "member_ids": [SYSTEM_USER_ID]},
                source="human",
                actor_id=SYSTEM_USER_ID,
                workspace_id=DEMO_WORKSPACE_ID,
                room_id=channel_id,
            )
        )

    monkeypatch.setattr("domain.demo.functions.get_command_bus", lambda: bus)
    return bus, state


def _patch_open_session(monkeypatch: pytest.MonkeyPatch, session: _StubSession) -> None:
    """Make ``with open_session() as s:`` yield our stub inside ``onboard``."""

    @contextmanager
    def _fake_open_session():
        yield session

    monkeypatch.setattr("domain.demo.functions.open_session", _fake_open_session)


def test_onboard_new_user_joins_workspace_and_default_channels(monkeypatch: pytest.MonkeyPatch) -> None:
    bus, state = _bootstrap_bus_with_demo_workspace(monkeypatch)
    session = _StubSession(
        workspace_members={(DEMO_WORKSPACE_ID, SYSTEM_USER_ID)},
        channel_members={(c, SYSTEM_USER_ID) for c in DEFAULT_CHANNEL_IDS},
    )
    _patch_open_session(monkeypatch, session)

    result = onboard(user_id="u_anon_bear", display_name="Anonymous Bear")

    assert result == {
        "user_id": "u_anon_bear",
        "display_name": "Anonymous Bear",
        "workspace_id": DEMO_WORKSPACE_ID,
        "default_channel_id": DEFAULT_LANDING_CHANNEL,
    }
    assert session.upserts == [{"user_id": "u_anon_bear", "display_name": "Anonymous Bear"}]
    assert session.commits == 1
    assert "u_anon_bear" in state.workspace_members[DEMO_WORKSPACE_ID]
    for channel_id in DEFAULT_CHANNEL_IDS:
        assert "u_anon_bear" in state.channel_members[channel_id]


def test_onboard_is_idempotent_when_user_already_joined(monkeypatch: pytest.MonkeyPatch) -> None:
    bus, state = _bootstrap_bus_with_demo_workspace(monkeypatch)
    bus.dispatch(
        Command(
            type="workspace:invite",
            payload={"user_id": "u_anon_bear", "role": "member"},
            source="human",
            actor_id=SYSTEM_USER_ID,
            workspace_id=DEMO_WORKSPACE_ID,
        )
    )
    for channel_id in DEFAULT_CHANNEL_IDS:
        bus.dispatch(
            Command(
                type="channel:invite",
                payload={"user_ids": ["u_anon_bear"]},
                source="human",
                actor_id=SYSTEM_USER_ID,
                workspace_id=DEMO_WORKSPACE_ID,
                room_id=channel_id,
            )
        )
    sequence_before = state.last_sequence[DEMO_WORKSPACE_ID]

    session = _StubSession(
        workspace_members={
            (DEMO_WORKSPACE_ID, SYSTEM_USER_ID),
            (DEMO_WORKSPACE_ID, "u_anon_bear"),
        },
        channel_members={(c, SYSTEM_USER_ID) for c in DEFAULT_CHANNEL_IDS}
        | {(c, "u_anon_bear") for c in DEFAULT_CHANNEL_IDS},
    )
    _patch_open_session(monkeypatch, session)

    onboard(user_id="u_anon_bear", display_name="Anonymous Bear")

    assert state.last_sequence[DEMO_WORKSPACE_ID] == sequence_before
