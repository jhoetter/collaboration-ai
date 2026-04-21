"""Phase 3 chat `@function` endpoints — DMs, threads, schedule, reminders, notifications."""

from __future__ import annotations

from typing import Any

from ..shared.decorators import function

from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus


@function(name="dm:open", mcp_expose=True, mcp_scope="write:dms")
def dm_open(
    workspace_id: str,
    participant_ids: list[str],
    *,
    actor_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="dm:open",
            payload={"participant_ids": participant_ids},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="threads:list-replies", mcp_expose=True, mcp_scope="read:messages")
def list_thread_replies(
    workspace_id: str,
    thread_root_id: str,
) -> list[dict[str, Any]]:
    from ..events.functions import get_projected_state

    state = get_projected_state(workspace_id)
    from ..chat.threads import list_replies

    return list_replies(state, thread_root_id)


@function(name="search:messages", mcp_expose=True, mcp_scope="read:messages")
def search_projection(
    workspace_id: str,
    query: str,
    *,
    channel_ids: list[str] | None = None,
    sender_id: str | None = None,
    limit: int = 50,
) -> list[dict[str, Any]]:
    """Projection-backed search; the SQL `chat:search` is faster, this
    one is the canonical fallback + reference impl used in tests."""
    from ..chat.search import search_messages
    from ..events.functions import get_projected_state

    state = get_projected_state(workspace_id)
    hits = search_messages(
        state,
        workspace_id=workspace_id,
        query=query,
        channel_ids=channel_ids,
        sender_id=sender_id,
        limit=limit,
    )
    return [
        {
            "message_id": h.message_id,
            "channel_id": h.channel_id,
            "sender_id": h.sender_id,
            "content": h.content,
            "sequence": h.sequence,
        }
        for h in hits
    ]


@function(name="unread:by-channel", mcp_expose=True, mcp_scope="read:messages")
def unread_by_channel(workspace_id: str, *, actor_id: str) -> list[dict[str, Any]]:
    from ..chat.unread import unread_for_user
    from ..events.functions import get_projected_state

    state = get_projected_state(workspace_id)
    return [
        {
            "channel_id": row.channel_id,
            "unread": row.unread,
            "mention_count": row.mention_count,
            "last_sequence": row.last_sequence,
        }
        for row in unread_for_user(state, user_id=actor_id, workspace_id=workspace_id)
    ]


@function(name="chat:schedule-message", mcp_expose=True, mcp_scope="write:scheduled")
def schedule_message(
    workspace_id: str,
    channel_id: str,
    fire_at: int,
    payload: dict[str, Any],
    *,
    actor_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:schedule-message",
            payload={"fire_at": fire_at, "payload": payload},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="chat:cancel-scheduled", mcp_expose=True, mcp_scope="write:scheduled")
def cancel_scheduled(workspace_id: str, scheduled_id: str, *, actor_id: str) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:cancel-scheduled",
            payload={"scheduled_id": scheduled_id},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:set-reminder", mcp_expose=True, mcp_scope="write:reminders")
def set_reminder(
    workspace_id: str,
    target_event_id: str,
    fire_at: int,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:set-reminder",
            payload={"target_event_id": target_event_id, "fire_at": fire_at},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:cancel-reminder", mcp_expose=True, mcp_scope="write:reminders")
def cancel_reminder(workspace_id: str, reminder_id: str, *, actor_id: str) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:cancel-reminder",
            payload={"reminder_id": reminder_id},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="notifications:list", mcp_expose=True, mcp_scope="read:notifications")
def list_notifications(workspace_id: str, *, actor_id: str, limit: int = 50) -> list[dict[str, Any]]:
    from ..events.functions import get_projected_state

    state = get_projected_state(workspace_id)
    user_notifs = state.notifications.get(actor_id, {})
    rows = sorted(user_notifs.values(), key=lambda n: n["created_at"], reverse=True)
    return [dict(r) for r in rows[:limit]]


@function(name="notifications:mark-read", mcp_expose=True, mcp_scope="write:notifications")
def mark_notification_read(workspace_id: str, notification_id: str, *, actor_id: str) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="notifications:mark-read",
            payload={"notification_id": notification_id},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()
