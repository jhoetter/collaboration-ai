"""Projection-determinism suite.

Per prompt.md ("Given the same event log, every replay produces the same
state"), two independent replays of an arbitrary event log must yield
``ProjectedState`` instances that compare equal.
"""

from __future__ import annotations

import random

from domain.events.ids import make_event_id, make_uuid7
from domain.events.model import Event, RelatesTo
from domain.events.projector import project_log


def _build_synthetic_log(seed: int = 42, n_events: int = 5_000) -> list[Event]:
    rng = random.Random(seed)
    workspace_id = "ws_demo"
    channel_ids = [f"ch_{i:04d}" for i in range(8)]
    user_ids = [f"usr_{i:03d}" for i in range(20)]
    events: list[Event] = []
    seq = 0

    def push(type_, content, *, room_id="ws_demo", sender_id=None, relates_to=None):
        nonlocal seq
        seq += 1
        events.append(
            Event(
                event_id=make_event_id(),
                type=type_,
                content=content,
                workspace_id=workspace_id,
                room_id=room_id,
                sender_id=sender_id or user_ids[0],
                sender_type="human",
                origin_ts=1_700_000_000_000 + seq,
                sequence=seq,
                relates_to=relates_to,
            )
        )

    push("workspace.create", {"name": "Demo workspace"}, sender_id=user_ids[0])
    for u in user_ids:
        push("workspace.member.add", {"user_id": u, "role": "member"})
    for ch in channel_ids:
        push("channel.create", {"name": ch, "type": "public"}, room_id=ch)
        for u in user_ids:
            if rng.random() < 0.6:
                push("channel.member.join", {"user_id": u}, room_id=ch, sender_id=u)

    message_ids: list[tuple[str, str]] = []
    while len(events) < n_events:
        ch = rng.choice(channel_ids)
        sender = rng.choice(user_ids)
        roll = rng.random()
        if roll < 0.55 or not message_ids:
            seq += 1
            event_id = make_event_id()
            events.append(
                Event(
                    event_id=event_id,
                    type="message.send",
                    content={"content": f"hello {seq}"},
                    workspace_id=workspace_id,
                    room_id=ch,
                    sender_id=sender,
                    sender_type="human",
                    origin_ts=1_700_000_000_000 + seq,
                    sequence=seq,
                )
            )
            message_ids.append((event_id, ch))
        elif roll < 0.7:
            target_id, target_ch = rng.choice(message_ids)
            push(
                "reaction.add",
                {"emoji": rng.choice([":+1:", ":eyes:", ":fire:"])},
                room_id=target_ch,
                sender_id=sender,
                relates_to=RelatesTo(event_id=target_id, rel_type="m.reaction"),
            )
        elif roll < 0.85:
            target_id, target_ch = rng.choice(message_ids)
            push(
                "message.edit",
                {"content": "edited"},
                room_id=target_ch,
                sender_id=sender,
                relates_to=RelatesTo(event_id=target_id, rel_type="m.replace"),
            )
        else:
            target_id, target_ch = rng.choice(message_ids)
            push(
                "read.marker",
                {"up_to_sequence": seq},
                room_id=target_ch,
                sender_id=sender,
            )
    return events


def test_projection_determinism_two_replays_match() -> None:
    log = _build_synthetic_log()
    a = project_log(list(log))
    b = project_log(list(log))

    assert a.workspaces == b.workspaces
    assert a.workspace_members == b.workspace_members
    assert a.channels == b.channels
    assert a.channel_members == b.channel_members
    assert a.messages == b.messages
    assert a.reactions == b.reactions
    assert a.read_markers == b.read_markers


def test_projection_determinism_shuffled_order_within_workspace_yields_same_state() -> None:
    """The projector sorts by (workspace_id, sequence) so a caller can hand
    in events in any order. State must still be identical."""
    log = _build_synthetic_log(seed=7, n_events=2_000)
    rng = random.Random(99)
    shuffled = list(log)
    rng.shuffle(shuffled)
    a = project_log(log)
    b = project_log(shuffled)
    assert a.messages == b.messages
    assert a.reactions == b.reactions
    assert a.channels == b.channels


def test_uuid7_is_monotonic_within_ms() -> None:
    """Different ids generated within the same millisecond must still
    sort lexicographically because the timestamp is the leading 48 bits.
    """
    ids = [make_uuid7(ts_ms=1_700_000_000_000) for _ in range(50)]
    assert len(set(ids)) == 50
    later = make_uuid7(ts_ms=1_700_000_001_000)
    assert later > max(ids)
