"""Chat `@function` endpoints — send / edit / delete / react / mark-read / search."""

from __future__ import annotations

from typing import Any

from hof import function
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus


@function(name="chat:send-message", mcp_expose=True, mcp_scope="write:messages")
def send_message(
    workspace_id: str,
    channel_id: str,
    content: str,
    *,
    thread_root: str | None = None,
    mentions: list[str] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    actor_id: str,
    source: str = "human",
    agent_id: str | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"content": content}
    if thread_root is not None:
        payload["thread_root"] = thread_root
    if mentions:
        payload["mentions"] = mentions
    if attachments:
        payload["attachments"] = attachments
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:send-message",
            payload=payload,
            source=source,  # type: ignore[arg-type]
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
            agent_id=agent_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="chat:edit-message", mcp_expose=True, mcp_scope="write:messages")
def edit_message(
    workspace_id: str,
    target_event_id: str,
    new_content: str,
    *,
    actor_id: str,
    mentions: list[str] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"target_event_id": target_event_id, "new_content": new_content}
    if mentions is not None:
        payload["mentions"] = mentions
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:edit-message",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="chat:delete-message", mcp_expose=True, mcp_scope="write:messages")
def delete_message(
    workspace_id: str,
    target_event_id: str,
    *,
    reason: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:delete-message",
            payload={"target_event_id": target_event_id, "reason": reason},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:add-reaction", mcp_expose=True, mcp_scope="write:reactions")
def add_reaction(
    workspace_id: str,
    target_event_id: str,
    emoji: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:add-reaction",
            payload={"target_event_id": target_event_id, "emoji": emoji},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:remove-reaction", mcp_expose=True, mcp_scope="write:reactions")
def remove_reaction(
    workspace_id: str,
    target_event_id: str,
    emoji: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:remove-reaction",
            payload={"target_event_id": target_event_id, "emoji": emoji},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:mark-read", mcp_expose=True, mcp_scope="write:read-markers")
def mark_read(
    workspace_id: str,
    up_to_event_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="chat:mark-read",
            payload={"up_to_event_id": up_to_event_id},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="chat:list-messages", mcp_expose=True, mcp_scope="read:messages")
def list_messages(
    channel_id: str,
    since_sequence: int = 0,
    limit: int = 100,
    *,
    session: Session,
) -> list[dict[str, Any]]:
    rows = session.execute(
        text(
            """
            SELECT message_id, channel_id, thread_root, sender_id, sender_type, agent_id,
                   content, mentions, attachments, edited_at, redacted, sequence, created_at
            FROM messages
            WHERE channel_id = :ch AND sequence > :s AND redacted = false
            ORDER BY sequence
            LIMIT :n
            """
        ),
        {"ch": channel_id, "s": since_sequence, "n": min(limit, 500)},
    ).mappings()
    return [dict(r) for r in rows]


@function(name="chat:search", mcp_expose=True, mcp_scope="read:messages")
def search(
    workspace_id: str,
    query: str,
    *,
    channel_ids: list[str] | None = None,
    from_user: str | None = None,
    limit: int = 50,
    session: Session,
) -> list[dict[str, Any]]:
    """Postgres tsvector search across the workspace."""
    sql = """
        SELECT m.message_id, m.channel_id, m.sender_id, m.created_at,
               ts_headline('simple', m.content, plainto_tsquery('simple', :q)) AS snippet,
               m.sequence
        FROM messages m
        JOIN message_search s ON s.message_id = m.message_id
        WHERE s.workspace_id = :w
          AND s.tsv @@ plainto_tsquery('simple', :q)
          AND m.redacted = false
    """
    params: dict[str, Any] = {"w": workspace_id, "q": query, "n": min(limit, 200)}
    if channel_ids:
        sql += " AND m.channel_id = ANY(:chs)"
        params["chs"] = list(channel_ids)
    if from_user:
        sql += " AND m.sender_id = :u"
        params["u"] = from_user
    sql += " ORDER BY m.sequence DESC LIMIT :n"
    rows = session.execute(text(sql), params).mappings()
    return [dict(r) for r in rows]
