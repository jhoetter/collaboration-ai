"""Scheduled messages + reminders: pure-Python drainer."""

from __future__ import annotations

from domain.chat.scheduler import (
    due_reminders,
    due_scheduled_messages,
    fire_reminder,
    fire_scheduled_message,
)
from domain.events.projector import project_event
from domain.shared.command_bus import Command

from .fixtures import bootstrap, send


def test_schedule_then_drain_emits_message_send() -> None:
    bs = bootstrap()
    res = bs.bus.dispatch(
        Command(
            type="chat:schedule-message",
            payload={
                "fire_at": 1_000,
                "payload": {"content": "Good morning team"},
            },
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )
    assert res.status == "applied"
    sched = next(iter(bs.state.scheduled_messages.values()))
    assert sched["status"] == "pending"

    # Drainer at T=2_000 finds the entry.
    due = list(due_scheduled_messages(bs.state, now_ms=2_000))
    assert len(due) == 1

    envs = fire_scheduled_message(due[0], sender_id=bs.users[1])
    assert any(e.type == "message.send" for e in envs)
    assert any(e.type == "message.scheduled.fired" for e in envs)


def test_set_reminder_then_fire_emits_notification() -> None:
    bs = bootstrap()
    msg_id = send(bs, bs.users[1], "ch_general", "remember this").events[0].event_id
    res = bs.bus.dispatch(
        Command(
            type="chat:set-reminder",
            payload={"target_event_id": msg_id, "fire_at": 5_000},
            source="human",
            actor_id=bs.users[2],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )
    assert res.status == "applied"
    rem = next(iter(bs.state.reminders.values()))
    assert rem["owner_id"] == bs.users[2]

    due = list(due_reminders(bs.state, now_ms=6_000))
    assert len(due) == 1

    envs = fire_reminder(due[0], target_msg=bs.state.messages[msg_id])
    assert any(e.type == "notification.create" for e in envs)
    assert any(e.type == "message.reminder.fired" for e in envs)


def test_cancel_scheduled_message_marks_it_cancelled() -> None:
    bs = bootstrap()
    res = bs.bus.dispatch(
        Command(
            type="chat:schedule-message",
            payload={"fire_at": 9_999_999, "payload": {"content": "later"}},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )
    sched_id = res.events[0].content["scheduled_id"]

    bs.bus.dispatch(
        Command(
            type="chat:cancel-scheduled",
            payload={"scheduled_id": sched_id},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )
    assert bs.state.scheduled_messages[sched_id]["status"] == "cancelled"


def test_fired_envelopes_apply_back_to_state() -> None:
    """End-to-end: drainer envelopes can be re-projected into ProjectedState."""
    from domain.events.model import Event

    bs = bootstrap()
    bs.bus.dispatch(
        Command(
            type="chat:schedule-message",
            payload={"fire_at": 1_000, "payload": {"content": "ping"}},
            source="human",
            actor_id=bs.users[1],
            workspace_id=bs.workspace_id,
            room_id="ch_general",
        )
    )
    sched = next(iter(bs.state.scheduled_messages.values()))
    envs = fire_scheduled_message(sched, sender_id=bs.users[1])

    # Manually assign sequences and project.
    base_seq = bs.state.last_sequence[bs.workspace_id]
    for i, env in enumerate(envs, start=1):
        evt = Event(
            event_id=env.event_id,
            type=env.type,
            content=env.content,
            workspace_id=env.workspace_id,
            room_id=env.room_id,
            sender_id=env.sender_id,
            sender_type=env.sender_type,
            origin_ts=2_000,
            sequence=base_seq + i,
            agent_id=env.agent_id,
            relates_to=env.relates_to,
            idempotency_key=env.idempotency_key,
        )
        project_event(bs.state, evt)

    assert bs.state.scheduled_messages[sched["id"]]["status"] == "fired"
