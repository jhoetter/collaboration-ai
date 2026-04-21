"""Idempotency suite.

Replaying the same event twice must not produce a different state.
Edits, redactions, and reactions all stress this property.
"""

from __future__ import annotations

from copy import deepcopy

from domain.events.ids import make_event_id
from domain.events.model import Event, RelatesTo
from domain.events.projector import ProjectedState, project_event, project_log


def _send(event_id: str, content: str, *, sequence: int) -> Event:
    return Event(
        event_id=event_id,
        type="message.send",
        content={"content": content},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_alice",
        sender_type="human",
        origin_ts=1_700_000_000_000 + sequence,
        sequence=sequence,
    )


def test_replaying_same_message_send_twice_is_no_op() -> None:
    e = _send("evt_msg_1", "hi", sequence=1)
    state = ProjectedState()
    project_event(state, e)
    snap = deepcopy(state.messages)
    project_event(state, e)
    assert state.messages == snap


def test_edit_after_redact_is_dropped() -> None:
    msg = _send("evt_msg_a", "hello", sequence=1)
    redact = Event(
        event_id="evt_redact_a",
        type="message.redact",
        content={"reason": "test"},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_alice",
        sender_type="human",
        origin_ts=1,
        sequence=2,
        relates_to=RelatesTo(event_id="evt_msg_a", rel_type="m.redact"),
    )
    edit = Event(
        event_id="evt_edit_a",
        type="message.edit",
        content={"content": "snuck in"},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_alice",
        sender_type="human",
        origin_ts=2,
        sequence=3,
        relates_to=RelatesTo(event_id="evt_msg_a", rel_type="m.replace"),
    )
    state = project_log([msg, redact, edit])
    final = state.messages["evt_msg_a"]
    assert final["redacted"] is True
    assert final["content"] == ""


def test_reactions_idempotent_per_user_emoji() -> None:
    msg = _send("evt_m_1", "hi", sequence=1)
    react_args = {
        "type": "reaction.add",
        "content": {"emoji": ":+1:"},
        "workspace_id": "ws_x",
        "room_id": "ch_general",
        "sender_id": "usr_bob",
        "sender_type": "human",
        "origin_ts": 1,
        "relates_to": RelatesTo(event_id="evt_m_1", rel_type="m.reaction"),
    }
    e1 = Event(event_id=make_event_id(), sequence=2, **react_args)
    e2 = Event(event_id=make_event_id(), sequence=3, **react_args)
    state = project_log([msg, e1, e2])
    assert state.reactions["evt_m_1"][":+1:"] == {"usr_bob"}


def test_simultaneous_reactions_from_distinct_users_are_independent() -> None:
    msg = _send("evt_m_2", "hi", sequence=1)
    e1 = Event(
        event_id="evt_r_a",
        type="reaction.add",
        content={"emoji": ":fire:"},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_alice",
        sender_type="human",
        origin_ts=1,
        sequence=2,
        relates_to=RelatesTo(event_id="evt_m_2", rel_type="m.reaction"),
    )
    e2 = Event(
        event_id="evt_r_b",
        type="reaction.add",
        content={"emoji": ":fire:"},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_bob",
        sender_type="human",
        origin_ts=1,
        sequence=3,
        relates_to=RelatesTo(event_id="evt_m_2", rel_type="m.reaction"),
    )
    state = project_log([msg, e1, e2])
    assert state.reactions["evt_m_2"][":fire:"] == {"usr_alice", "usr_bob"}


def test_read_markers_only_advance_forward() -> None:
    msg_a = _send("evt_a", "1", sequence=1)
    msg_b = _send("evt_b", "2", sequence=2)
    msg_c = _send("evt_c", "3", sequence=3)
    mark_b = Event(
        event_id="evt_mark1",
        type="read.marker",
        content={"up_to_sequence": 2},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_carol",
        sender_type="human",
        origin_ts=10,
        sequence=4,
    )
    mark_a = Event(
        event_id="evt_mark2",
        type="read.marker",
        content={"up_to_sequence": 1},  # backwards — must be ignored
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_carol",
        sender_type="human",
        origin_ts=11,
        sequence=5,
    )
    mark_c = Event(
        event_id="evt_mark3",
        type="read.marker",
        content={"up_to_sequence": 3},
        workspace_id="ws_x",
        room_id="ch_general",
        sender_id="usr_carol",
        sender_type="human",
        origin_ts=12,
        sequence=6,
    )
    state = project_log([msg_a, msg_b, msg_c, mark_b, mark_a, mark_c])
    assert state.read_markers["usr_carol"]["ch_general"] == 3
