"""Pure logic for the Celery beat job that drains scheduled messages
and reminders. The wrapper that actually runs in Celery lives in
``app/domain/chat/cron.py`` (Phase 5 will add it once we wire Celery
into hof-engine); this module is the testable kernel.
"""

from __future__ import annotations

from typing import Iterator

from ..events.ids import make_event_id, make_notification_id
from ..events.model import EventEnvelope
from ..events.projector import ProjectedState


def due_scheduled_messages(state: ProjectedState, *, now_ms: int) -> Iterator[dict]:
    for sched in state.scheduled_messages.values():
        if sched["status"] == "pending" and int(sched["fire_at"]) <= now_ms:
            yield sched


def due_reminders(state: ProjectedState, *, now_ms: int) -> Iterator[dict]:
    for rem in state.reminders.values():
        if rem["status"] == "pending" and int(rem["fire_at"]) <= now_ms:
            yield rem


def fire_scheduled_message(sched: dict, *, sender_id: str) -> list[EventEnvelope]:
    """Emit a `message.send` + a `message.scheduled.fired` envelope."""
    payload = sched["payload"]
    msg_env = EventEnvelope(
        event_id=make_event_id(),
        type="message.send",
        content=payload,
        workspace_id=sched["workspace_id"],
        room_id=sched["channel_id"],
        sender_id=sender_id,
        sender_type="human",
        idempotency_key=f"scheduled:{sched['id']}",
    )
    fired_env = EventEnvelope(
        event_id=make_event_id(),
        type="message.scheduled.fired",
        content={"scheduled_id": sched["id"], "message_event_id": msg_env.event_id},
        workspace_id=sched["workspace_id"],
        room_id=sched["channel_id"],
        sender_id=sender_id,
        sender_type="system",
        idempotency_key=f"scheduled:fired:{sched['id']}",
    )
    return [msg_env, fired_env]


def fire_reminder(rem: dict, *, target_msg: dict | None) -> list[EventEnvelope]:
    """Emit a `notification.create` and a `message.reminder.fired` envelope."""
    notif_env = EventEnvelope(
        event_id=make_event_id(),
        type="notification.create",
        content={
            "user_id": rem["owner_id"],
            "notification_id": make_notification_id(),
            "kind": "reminder",
            "target_event_id": rem.get("target_event_id"),
            "body": (target_msg.get("content") if target_msg else "Reminder")[:200],
        },
        workspace_id=rem["workspace_id"],
        room_id=rem["channel_id"],
        sender_id="system",
        sender_type="system",
        idempotency_key=f"reminder:{rem['id']}",
    )
    fired_env = EventEnvelope(
        event_id=make_event_id(),
        type="message.reminder.fired",
        content={"reminder_id": rem["id"]},
        workspace_id=rem["workspace_id"],
        room_id=rem["channel_id"],
        sender_id="system",
        sender_type="system",
        idempotency_key=f"reminder:fired:{rem['id']}",
    )
    return [notif_env, fired_env]
