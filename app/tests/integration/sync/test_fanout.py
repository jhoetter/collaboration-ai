"""Fanout + bounded queue + presence tracker."""

from __future__ import annotations

from domain.events.model import Event
from domain.sync.fanout import InProcessFanout
from domain.sync.presence import InMemoryTTLStore, PresenceTracker
from domain.sync.queue import BoundedQueue


def _evt(workspace_id: str, room_id: str, seq: int, *, event_id: str | None = None) -> Event:
    return Event(
        event_id=event_id or f"evt_{seq}",
        type="message.send",
        content={"content": str(seq)},
        workspace_id=workspace_id,
        room_id=room_id,
        sender_id="usr_a",
        sender_type="human",
        origin_ts=seq,
        sequence=seq,
    )


def test_fanout_delivers_to_subscribers_in_same_workspace() -> None:
    fan = InProcessFanout()
    q1 = BoundedQueue()
    q2 = BoundedQueue()
    fan.subscribe("ws_a", set(), q1)
    fan.subscribe("ws_b", set(), q2)
    delivered = fan.publish(_evt("ws_a", "ch_x", 1))
    assert delivered == 1
    assert len(q1) == 1
    assert len(q2) == 0


def test_fanout_filters_by_room_when_room_set_is_non_empty() -> None:
    fan = InProcessFanout()
    q_general = BoundedQueue()
    q_random = BoundedQueue()
    fan.subscribe("ws", {"ch_general"}, q_general)
    fan.subscribe("ws", {"ch_random"}, q_random)
    fan.publish(_evt("ws", "ch_general", 1))
    fan.publish(_evt("ws", "ch_random", 2))
    fan.publish(_evt("ws", "ch_general", 3))
    assert len(q_general) == 2
    assert len(q_random) == 1


def test_bounded_queue_overflow_marks_subscription() -> None:
    fan = InProcessFanout()
    q = BoundedQueue(maxsize=2)
    sub_id = fan.subscribe("ws", set(), q)
    fan.publish(_evt("ws", "x", 1))
    fan.publish(_evt("ws", "x", 2))
    fan.publish(_evt("ws", "x", 3))  # overflow
    assert sub_id in fan.overflowed_subscription_ids
    assert q.overflowed is True
    assert len(q) == 2


def test_presence_set_get_expire() -> None:
    clock = {"now": 1_700_000_000_000}
    store = InMemoryTTLStore(clock_ms=lambda: clock["now"])
    p = PresenceTracker(store=store, presence_ttl_s=60)
    p.heartbeat("ws", "usr_a", status="active")
    assert p.status("ws", "usr_a") == "active"
    clock["now"] += 30_000
    assert p.status("ws", "usr_a") == "active"
    clock["now"] += 31_000
    assert p.status("ws", "usr_a") == "offline"


def test_typing_users_are_listable_per_channel() -> None:
    clock = {"now": 0}
    store = InMemoryTTLStore(clock_ms=lambda: clock["now"])
    p = PresenceTracker(store=store, typing_ttl_s=4)
    p.typing_start("ch", "usr_a")
    p.typing_start("ch", "usr_b")
    p.typing_start("other_ch", "usr_c")
    assert sorted(p.typing_users("ch")) == ["usr_a", "usr_b"]
    clock["now"] += 5_000
    assert p.typing_users("ch") == []


def test_workspace_presence_returns_only_live_users() -> None:
    clock = {"now": 0}
    store = InMemoryTTLStore(clock_ms=lambda: clock["now"])
    p = PresenceTracker(store=store, presence_ttl_s=60)
    p.heartbeat("ws", "usr_a")
    p.heartbeat("ws", "usr_b", status="dnd")
    snap = p.workspace_presence("ws")
    assert snap == {"usr_a": "active", "usr_b": "dnd"}
