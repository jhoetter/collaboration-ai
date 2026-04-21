"""Unread + mention counts derived from read markers."""

from __future__ import annotations

from domain.chat.unread import unread_for_user
from domain.shared.command_bus import Command

from .fixtures import bootstrap, send


def test_unread_counts_decrement_after_mark_read() -> None:
    bs = bootstrap()
    sent = []
    for i in range(5):
        sent.append(send(bs, bs.users[1], "ch_general", f"msg {i}").events[0].event_id)

    # User 2 reads up to the third message (index 2).
    bs.bus.dispatch(
        Command(
            type="chat:mark-read",
            payload={"up_to_event_id": sent[2]},
            source="human",
            actor_id=bs.users[2],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )

    rows = {row.channel_id: row for row in unread_for_user(bs.state, user_id=bs.users[2], workspace_id=bs.workspace_id)}
    assert rows["ch_general"].unread == 2
    assert rows["ch_general"].mention_count == 0


def test_mention_count_is_independent_of_total_unread() -> None:
    bs = bootstrap()
    target = bs.users[2]
    for i in range(5):
        send(
            bs,
            bs.users[1],
            "ch_general",
            f"msg {i}",
            mentions=[target] if i in (1, 3) else [],
        )

    rows = {row.channel_id: row for row in unread_for_user(bs.state, user_id=target, workspace_id=bs.workspace_id)}
    assert rows["ch_general"].unread == 5
    assert rows["ch_general"].mention_count == 2
