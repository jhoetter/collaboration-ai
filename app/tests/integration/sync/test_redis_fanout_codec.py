"""Round-trip Event JSON serialization for the Redis bridge."""

from __future__ import annotations

from domain.events.model import Event, RelatesTo
from domain.sync.redis_fanout import _event_from_json, _event_to_json, channel_for


def test_round_trip_preserves_all_fields() -> None:
    e = Event(
        event_id="evt_x",
        type="message.send",
        content={"content": "hello", "mentions": ["usr_a"]},
        workspace_id="ws_1",
        room_id="ch_general",
        sender_id="usr_a",
        sender_type="human",
        origin_ts=1_700_000_000_000,
        sequence=42,
        agent_id=None,
        relates_to=RelatesTo(event_id="evt_w", rel_type="m.thread"),
        idempotency_key="cli_1",
        origin={"source": "test"},
    )
    decoded = _event_from_json(_event_to_json(e))
    assert decoded == e


def test_channel_naming_isolates_workspaces() -> None:
    assert channel_for("ws_a") == "collabai:events:ws_a"
    assert channel_for("ws_b") != channel_for("ws_a")
