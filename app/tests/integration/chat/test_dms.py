"""DMs: idempotent open + correct channel shape."""

from __future__ import annotations

from domain.shared.command_bus import Command

from .fixtures import bootstrap


def test_dm_open_is_idempotent_for_same_participant_set() -> None:
    bs = bootstrap()
    a, b = bs.users[1], bs.users[2]
    r1 = bs.bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": [a, b]},
            source="human",
            actor_id=a,
            workspace_id=bs.workspace_id,
        )
    )
    assert r1.status == "applied"
    dm_channel_id = next(e.room_id for e in r1.events if e.type == "dm.create")

    # Same participants, opposite order, opened by `b`.
    r2 = bs.bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": [b, a]},
            source="human",
            actor_id=b,
            workspace_id=bs.workspace_id,
        )
    )
    assert r2.status == "applied"
    assert r2.events == []  # no new events emitted
    assert dm_channel_id in bs.state.channels


def test_dm_channel_is_private_dm_typed() -> None:
    bs = bootstrap()
    bs.bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": [bs.users[1], bs.users[2]]},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
        )
    )
    dm = next(c for c in bs.state.channels.values() if c.get("type") == "dm")
    assert dm["private"] is True
    members = bs.state.channel_members[dm["id"]]
    assert set(members.keys()) == {bs.users[1], bs.users[2]}


def test_group_dm_channel_is_typed_group_dm() -> None:
    bs = bootstrap()
    bs.bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": [bs.users[1], bs.users[2], bs.users[3]]},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
        )
    )
    dm = next(c for c in bs.state.channels.values() if c.get("type") == "group_dm")
    assert dm["private"] is True
    members = bs.state.channel_members[dm["id"]]
    assert set(members.keys()) == {bs.users[1], bs.users[2], bs.users[3]}


def test_dm_with_non_member_is_rejected() -> None:
    bs = bootstrap()
    res = bs.bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": [bs.users[1], "usr_outsider"]},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
        )
    )
    assert res.status == "rejected"
    assert res.error and res.error.code == "invalid_payload"
