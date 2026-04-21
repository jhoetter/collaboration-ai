"""``app/scripts/seed.py`` smoke tests.

We don't have a Postgres fixture in this suite, so the test below
exercises the seed's bus-side orchestration with a stub session +
in-memory ``CommandBus``. The shape of the test mirrors what the
script does end-to-end:

1. Create the workspace via the bus (no double-seed).
2. Create the three default channels.
3. Dispatch the planner agent's pending proposals.
4. Re-running with the same "already-seeded" state is a no-op (no
   extra events committed).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import pytest

from domain.events.projector import ProjectedState
from domain.shared.command_bus import Command, CommandBus
from domain.shared.handlers import register_default_handlers


@dataclass
class _Result:
    rows: list[tuple[Any, ...]]
    mapping_rows: list[dict[str, Any]] = field(default_factory=list)

    def first(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows

    def mappings(self):
        return self.mapping_rows


@dataclass
class _StubSession:
    workspaces: set[str] = field(default_factory=set)
    channels_by_ws: dict[str, set[str]] = field(default_factory=dict)
    proposals_by_ws: dict[str, list[tuple[str, dict[str, Any]]]] = field(default_factory=dict)
    workspace_members: set[tuple[str, str]] = field(default_factory=set)
    channel_members: set[tuple[str, str]] = field(default_factory=set)
    seeded_event_keys: set[str] = field(default_factory=set)
    upserts: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    commits: int = 0

    def execute(self, statement, params: dict[str, Any] | None = None):  # noqa: ANN201
        sql = str(statement)
        params = params or {}
        if "FROM workspaces" in sql:
            return _Result(rows=[(1,)] if params["w"] in self.workspaces else [])
        if "channel_id FROM channels" in sql:
            channels = self.channels_by_ws.get(params["w"], set())
            return _Result(rows=[(c,) for c in channels])
        if "FROM workspace_members" in sql:
            present = (params["w"], params["u"]) in self.workspace_members
            return _Result(rows=[(1,)] if present else [])
        if "FROM channel_members" in sql:
            present = (params["c"], params["u"]) in self.channel_members
            return _Result(rows=[(1,)] if present else [])
        if "FROM events" in sql:
            present = params.get("k") in self.seeded_event_keys
            return _Result(rows=[(1,)] if present else [])
        if "FROM proposals" in sql:
            rows = [
                {"channel_id": cid, "payload": payload}
                for cid, payload in self.proposals_by_ws.get(params["w"], [])
            ]
            return _Result(rows=[], mapping_rows=rows)
        # Capture every INSERT for visibility but the tests assert via
        # the bus + state, not via the SQL log.
        self.upserts.append((sql, params))
        return _Result(rows=[])

    def commit(self) -> None:
        self.commits += 1


@dataclass
class _SessionFactory:
    session: _StubSession

    def __call__(self):
        return self

    def __enter__(self):
        return self.session

    def __exit__(self, *_):
        return False


def _install_bus(monkeypatch: pytest.MonkeyPatch) -> tuple[CommandBus, ProjectedState]:
    state = ProjectedState()
    bus = register_default_handlers(CommandBus(projector_state=state))
    monkeypatch.setattr("domain.shared.runtime.get_command_bus", lambda: bus)
    return bus, state


def test_seed_creates_workspace_channels_and_pending_proposals(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from scripts import seed

    bus, state = _install_bus(monkeypatch)
    session = _StubSession()
    factory = _SessionFactory(session=session)

    monkeypatch.setattr("domain.shared.runtime.get_session_factory", lambda: factory)
    monkeypatch.setattr(seed, "hof_bootstrap", lambda _root: None)

    seed.main()

    assert seed.DEMO_WORKSPACE_ID in state.workspaces
    members = state.workspace_members[seed.DEMO_WORKSPACE_ID]
    assert seed.SYSTEM_USER_ID in members
    assert members[seed.SYSTEM_USER_ID]["role"] == "owner"

    for channel_id, _name, _topic in seed.DEFAULT_CHANNELS:
        assert channel_id in state.channels
        assert seed.SYSTEM_USER_ID in state.channel_members[channel_id]

    proposals = list(state.proposals.values())
    assert len(proposals) == len(seed.DEMO_PROPOSALS)
    assert all(p["status"] == "pending" for p in proposals)
    assert all(p["agent_id"] == seed.PLANNER_AGENT_ID for p in proposals)


def test_seed_is_idempotent_on_rerun(monkeypatch: pytest.MonkeyPatch) -> None:
    from scripts import seed

    bus, state = _install_bus(monkeypatch)
    session = _StubSession(
        workspaces={seed.DEMO_WORKSPACE_ID},
        channels_by_ws={
            seed.DEMO_WORKSPACE_ID: {cid for cid, _name, _topic in seed.DEFAULT_CHANNELS}
        },
        proposals_by_ws={
            seed.DEMO_WORKSPACE_ID: [
                (spec["channel_id"], {"content": spec["content"]})
                for spec in seed.DEMO_PROPOSALS
            ]
        },
        workspace_members={
            (seed.DEMO_WORKSPACE_ID, seed.SYSTEM_USER_ID),
            (seed.DEMO_WORKSPACE_ID, seed.DEMO_PARTNER_USER_ID),
        },
        channel_members={
            (cid, seed.DEMO_PARTNER_USER_ID) for cid, _n, _t in seed.DEFAULT_CHANNELS
        },
        seeded_event_keys={seed._SEED_MESSAGES_MARKER},
    )
    factory = _SessionFactory(session=session)
    monkeypatch.setattr("domain.shared.runtime.get_session_factory", lambda: factory)
    monkeypatch.setattr(seed, "hof_bootstrap", lambda _root: None)

    seed.main()

    assert state.last_sequence == {}
    assert state.workspaces == {}
    assert state.proposals == {}
