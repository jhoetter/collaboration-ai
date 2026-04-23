"""Huddle command-handler acceptance tests.

We exercise the full ``start → join → leave → end`` lifecycle through
the projector to make sure:
  * a non-member cannot start a huddle
  * a second start is idempotent (re-uses the running huddle id)
  * the projection materialises participants + ``ended_at``
  * leave is best-effort idempotent (no error when no huddle is open)
"""

from __future__ import annotations

from domain.shared.command_bus import Command
from tests.integration.chat.fixtures import bootstrap


def _start(bs, actor: str, channel: str = "ch_general", **payload):
    return bs.bus.dispatch(
        Command(
            type="huddle:start",
            payload=payload,
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
            room_id=channel,
        )
    )


def _join(bs, actor: str, channel: str = "ch_general"):
    return bs.bus.dispatch(
        Command(
            type="huddle:join",
            payload={},
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
            room_id=channel,
        )
    )


def _leave(bs, actor: str, channel: str = "ch_general"):
    return bs.bus.dispatch(
        Command(
            type="huddle:leave",
            payload={},
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
            room_id=channel,
        )
    )


def _end(bs, actor: str, channel: str = "ch_general"):
    return bs.bus.dispatch(
        Command(
            type="huddle:end",
            payload={},
            source="human",
            actor_id=actor,
            workspace_id=bs.workspace_id,
            room_id=channel,
        )
    )


def test_start_creates_huddle_with_owner_as_first_participant() -> None:
    bs = bootstrap()
    owner = bs.users[0]
    res = _start(bs, owner, title="Sync")
    assert res.status == "applied", res.error
    huddle = bs.state.huddles["ch_general"]
    assert huddle["channel_id"] == "ch_general"
    assert owner in huddle["participants"]
    assert huddle.get("ended_at") is None
    assert huddle.get("title") == "Sync"


def test_second_start_is_idempotent_and_returns_same_id() -> None:
    bs = bootstrap()
    owner = bs.users[0]
    other = bs.users[1]
    first = _start(bs, owner)
    assert first.status == "applied"
    huddle_id = bs.state.huddles["ch_general"]["huddle_id"]

    second = _start(bs, other)
    assert second.status == "applied"
    assert bs.state.huddles["ch_general"]["huddle_id"] == huddle_id
    assert other in bs.state.huddles["ch_general"]["participants"]


def test_non_member_cannot_start_or_join() -> None:
    bs = bootstrap()
    intruder = "usr_outsider"
    rejected = _start(bs, intruder)
    assert rejected.status == "rejected"
    assert rejected.error and rejected.error.code == "forbidden"


def test_join_requires_active_huddle() -> None:
    bs = bootstrap()
    res = _join(bs, bs.users[0])
    assert res.status == "rejected"
    assert res.error and res.error.code == "not_found"


def test_leave_when_no_huddle_is_a_noop() -> None:
    bs = bootstrap()
    res = _leave(bs, bs.users[0])
    assert res.status == "applied"
    assert res.events == []


def test_full_lifecycle_start_join_leave_end() -> None:
    bs = bootstrap()
    owner, alice, bob = bs.users[0], bs.users[1], bs.users[2]

    _start(bs, owner)
    _join(bs, alice)
    _join(bs, bob)
    huddle = bs.state.huddles["ch_general"]
    assert set(huddle["participants"]) == {owner, alice, bob}

    _leave(bs, alice)
    assert alice not in bs.state.huddles["ch_general"]["participants"]

    end_res = _end(bs, owner)
    assert end_res.status == "applied"
    # `huddle.end` clears the active huddle slot for the channel.
    assert "ch_general" not in bs.state.huddles


def test_last_leaver_auto_ends_meeting() -> None:
    """When the final participant leaves the projected huddle is torn
    down by an automatic ``huddle.end`` follow-up event so the channel
    no longer shows a phantom "meeting in progress" banner."""
    bs = bootstrap()
    owner, alice = bs.users[0], bs.users[1]
    _start(bs, owner)
    _join(bs, alice)
    assert "ch_general" in bs.state.huddles

    _leave(bs, owner)
    # Owner left, alice is still here — the meeting must persist.
    assert "ch_general" in bs.state.huddles
    assert owner not in bs.state.huddles["ch_general"]["participants"]

    # Alice leaves last — this leave must collapse to a `huddle.end` and
    # remove the active huddle slot.
    last_leave = _leave(bs, alice)
    assert last_leave.status == "applied"
    assert "ch_general" not in bs.state.huddles


def test_huddle_start_notifies_other_channel_members() -> None:
    """Starting a meeting fans out a `meeting.started` notification to
    every other channel member so they see it in their inbox even if
    they aren't actively viewing the channel."""
    bs = bootstrap()
    owner = bs.users[0]
    res = _start(bs, owner, title="Standup")
    assert res.status == "applied"
    types = [e.type for e in res.events]
    assert types[0] == "huddle.start"
    notifs = [e for e in res.events if e.type == "notification.create"]
    # Owner is excluded; every other member of #ch_general gets one.
    expected_recipients = set(bs.users) - {owner}
    actual_recipients = {n.content["user_id"] for n in notifs}
    assert actual_recipients == expected_recipients
    for n in notifs:
        assert n.content["kind"] == "meeting.started"
        assert n.content["body"] == "Standup"
        assert n.content["huddle_id"] == bs.state.huddles["ch_general"]["huddle_id"]


def test_only_host_or_admin_can_end_meeting() -> None:
    bs = bootstrap()
    owner, alice = bs.users[0], bs.users[1]
    _start(bs, owner)
    _join(bs, alice)

    # Alice is a regular member, not the meeting host.
    forbidden = _end(bs, alice)
    assert forbidden.status == "rejected"
    assert forbidden.error and forbidden.error.code == "forbidden"
    # Meeting still active.
    assert "ch_general" in bs.state.huddles

    # The original host can end it.
    res = _end(bs, owner)
    assert res.status == "applied"
    assert "ch_general" not in bs.state.huddles


def test_start_requires_room_id() -> None:
    bs = bootstrap()
    res = bs.bus.dispatch(
        Command(
            type="huddle:start",
            payload={},
            source="human",
            actor_id=bs.users[0],
            workspace_id=bs.workspace_id,
            room_id=None,
        )
    )
    assert res.status == "rejected"
    assert res.error and res.error.code == "invalid_command"
