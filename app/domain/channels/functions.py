"""Channel `@function` endpoints."""

from __future__ import annotations

from typing import Any

from ..shared.decorators import function

from ..events.ids import make_channel_id
from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus, open_session


@function(name="channel:create", mcp_expose=True, mcp_scope="write:channels")
def create_channel(
    workspace_id: str,
    name: str,
    *,
    type: str = "public",
    private: bool = False,
    topic: str | None = None,
    description: str | None = None,
    staging_policy: str = "agent-messages-require-approval",
    slow_mode_seconds: int = 0,
    member_ids: list[str] | None = None,
    actor_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    channel_id = make_channel_id()
    payload: dict[str, Any] = {
        "name": name,
        "type": type,
        "private": private,
        "staging_policy": staging_policy,
        "slow_mode_seconds": slow_mode_seconds,
        "member_ids": list(member_ids or []),
    }
    if topic is not None:
        payload["topic"] = topic
    if description is not None:
        payload["description"] = description
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:create",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="channel:invite", mcp_expose=True, mcp_scope="write:channels")
def invite(
    workspace_id: str,
    channel_id: str,
    user_ids: list[str],
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:invite",
            payload={"user_ids": user_ids},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:set-topic", mcp_expose=True, mcp_scope="write:channels")
def set_topic(
    workspace_id: str,
    channel_id: str,
    topic: str | None,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:set-topic",
            payload={"topic": topic},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:list", mcp_expose=True, mcp_scope="read:channels")
def list_channels(workspace_id: str) -> list[dict[str, Any]]:
    """Return channels visible to the caller. Real ACL filtering lives in
    a separate ``permissions`` helper plugged in by the auth middleware.
    """
    from sqlalchemy import text

    with open_session() as session:
        rows = session.execute(
            text(
                "SELECT * FROM channels WHERE workspace_id = :w AND archived = false ORDER BY name"
            ),
            {"w": workspace_id},
        ).mappings()
        return [dict(r) for r in rows]
