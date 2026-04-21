"""Mentions trigger notifications; non-member mentions are rejected."""

from __future__ import annotations

from domain.shared.command_bus import Command

from .fixtures import bootstrap, send


def test_mention_emits_notifications_for_mentioned_users_only() -> None:
    bs = bootstrap()
    sender = bs.users[1]
    targets = [bs.users[2], bs.users[3]]
    res = send(bs, sender, "ch_general", "hi @people", mentions=targets)
    assert res.status == "applied"
    notif_events = [e for e in res.events if e.type == "notification.create"]
    assert len(notif_events) == 2
    assert {e.content["user_id"] for e in notif_events} == set(targets)
    # The sender does not get pinged for their own mention.
    assert sender not in {e.content["user_id"] for e in notif_events}


def test_mention_of_non_workspace_member_is_rejected() -> None:
    bs = bootstrap()
    res = send(bs, bs.users[1], "ch_general", "ping", mentions=["usr_outsider"])
    assert res.status == "rejected"
    assert res.error and res.error.code == "invalid_payload"


def test_self_mention_does_not_create_notification_for_sender() -> None:
    bs = bootstrap()
    res = send(bs, bs.users[1], "ch_general", "noting myself", mentions=[bs.users[1]])
    assert res.status == "applied"
    assert all(e.type != "notification.create" for e in res.events)


def test_notifications_mark_read_flips_state() -> None:
    bs = bootstrap()
    res = send(bs, bs.users[1], "ch_general", "hey", mentions=[bs.users[2]])
    notif_id = next(e.content["notification_id"] for e in res.events if e.type == "notification.create")
    assert bs.state.notifications[bs.users[2]][notif_id]["read"] is False

    bs.bus.dispatch(
        Command(
            type="notifications:mark-read",
            payload={"notification_id": notif_id},
            source="human",
            actor_id=bs.users[2],
            workspace_id=bs.workspace_id,
        )
    )
    assert bs.state.notifications[bs.users[2]][notif_id]["read"] is True
