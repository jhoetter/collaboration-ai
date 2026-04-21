"""Threads: replies bump the root's reply count + appear ordered."""

from __future__ import annotations

from domain.chat.threads import list_replies, list_threads_in_channel

from .fixtures import bootstrap, send


def test_replies_increment_root_reply_count_and_list_in_order() -> None:
    bs = bootstrap()
    root = send(bs, bs.users[1], "ch_general", "kicking off a thread").events[0].event_id
    r1 = send(bs, bs.users[2], "ch_general", "reply one", thread_root=root).events[0].event_id
    r2 = send(bs, bs.users[3], "ch_general", "reply two", thread_root=root).events[0].event_id
    r3 = send(bs, bs.users[1], "ch_general", "reply three", thread_root=root).events[0].event_id

    assert bs.state.messages[root]["thread_reply_count"] == 3

    replies = list_replies(bs.state, root)
    assert [m["id"] for m in replies] == [r1, r2, r3]

    threads = list_threads_in_channel(bs.state, "ch_general")
    assert [t["id"] for t in threads] == [root]


def test_thread_root_must_belong_to_same_channel() -> None:
    bs = bootstrap()
    root = send(bs, bs.users[1], "ch_general", "root").events[0].event_id
    res = send(bs, bs.users[1], "ch_random", "wrong room", thread_root=root)
    assert res.status == "rejected"
    assert res.error and res.error.code == "invalid_payload"


def test_thread_reply_to_unknown_root_is_rejected() -> None:
    bs = bootstrap()
    res = send(bs, bs.users[1], "ch_general", "lol", thread_root="evt_does_not_exist")
    assert res.status == "rejected"
    assert res.error and res.error.code == "invalid_payload"
