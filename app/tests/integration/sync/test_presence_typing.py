"""Pure-logic tests for ``PresenceTracker`` over the in-memory TTL store.

These cover the contract the WS gateway relies on:
  * presence heartbeats expire after ``presence_ttl_s``
  * typing indicators expire much faster
  * ``workspace_presence`` only returns live users
  * ``typing_users`` is per-channel
"""

from __future__ import annotations

from domain.sync.presence import InMemoryTTLStore, PresenceTracker


class _Clock:
    def __init__(self) -> None:
        self.now_ms = 0

    def __call__(self) -> int:
        return self.now_ms

    def advance(self, seconds: float) -> None:
        self.now_ms += int(seconds * 1000)


def _tracker(presence_ttl_s: int = 60, typing_ttl_s: int = 4) -> tuple[PresenceTracker, _Clock]:
    clock = _Clock()
    store = InMemoryTTLStore(clock_ms=clock)
    return PresenceTracker(store=store, presence_ttl_s=presence_ttl_s, typing_ttl_s=typing_ttl_s), clock


def test_presence_heartbeat_and_status() -> None:
    tracker, _clock = _tracker()
    tracker.heartbeat("ws1", "u1", status="active")
    tracker.heartbeat("ws1", "u2", status="away")

    assert tracker.status("ws1", "u1") == "active"
    assert tracker.status("ws1", "u2") == "away"
    assert tracker.status("ws1", "missing") == "offline"

    presence = tracker.workspace_presence("ws1")
    assert presence == {"u1": "active", "u2": "away"}


def test_presence_expires_after_ttl() -> None:
    tracker, clock = _tracker(presence_ttl_s=30)
    tracker.heartbeat("ws1", "u1")
    clock.advance(31)
    assert tracker.status("ws1", "u1") == "offline"
    assert tracker.workspace_presence("ws1") == {}


def test_typing_indicator_is_per_channel_and_short_lived() -> None:
    tracker, clock = _tracker(typing_ttl_s=4)
    tracker.typing_start("c_general", "u1")
    tracker.typing_start("c_general", "u2")
    tracker.typing_start("c_random", "u1")

    assert sorted(tracker.typing_users("c_general")) == ["u1", "u2"]
    assert tracker.typing_users("c_random") == ["u1"]

    clock.advance(5)
    assert tracker.typing_users("c_general") == []
    assert tracker.typing_users("c_random") == []


def test_workspace_presence_isolated_per_workspace() -> None:
    tracker, _clock = _tracker()
    tracker.heartbeat("ws1", "u1")
    tracker.heartbeat("ws2", "u1")
    assert set(tracker.workspace_presence("ws1")) == {"u1"}
    assert set(tracker.workspace_presence("ws2")) == {"u1"}
    assert tracker.workspace_presence("ws3") == {}
