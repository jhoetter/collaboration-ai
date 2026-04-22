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


@function(name="channel:update", mcp_expose=True, mcp_scope="write:channels")
def update_channel(
    workspace_id: str,
    channel_id: str,
    *,
    name: str | None = None,
    topic: str | None = None,
    description: str | None = None,
    staging_policy: str | None = None,
    slow_mode_seconds: int | None = None,
    actor_id: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if name is not None:
        payload["name"] = name
    if topic is not None:
        payload["topic"] = topic
    if description is not None:
        payload["description"] = description
    if staging_policy is not None:
        payload["staging_policy"] = staging_policy
    if slow_mode_seconds is not None:
        payload["slow_mode_seconds"] = slow_mode_seconds
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:update",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:archive", mcp_expose=True, mcp_scope="write:channels")
def archive_channel(workspace_id: str, channel_id: str, *, actor_id: str) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:archive",
            payload={},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:unarchive", mcp_expose=True, mcp_scope="write:channels")
def unarchive_channel(workspace_id: str, channel_id: str, *, actor_id: str) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:unarchive",
            payload={},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:leave", mcp_expose=True, mcp_scope="write:channels")
def leave_channel(
    workspace_id: str,
    channel_id: str,
    *,
    user_id: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if user_id is not None:
        payload["user_id"] = user_id
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:leave",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:kick", mcp_expose=True, mcp_scope="write:channels")
def kick_from_channel(
    workspace_id: str,
    channel_id: str,
    user_id: str,
    *,
    reason: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="channel:kick",
            payload={"user_id": user_id, "reason": reason},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="channel:list", mcp_expose=True, mcp_scope="read:channels")
def list_channels(
    workspace_id: str,
    *,
    include_archived: bool = False,
) -> list[dict[str, Any]]:
    """Return channels visible to the caller. Real ACL filtering lives in
    a separate ``permissions`` helper plugged in by the auth middleware.
    """
    from sqlalchemy import text

    sql = "SELECT * FROM channels WHERE workspace_id = :w"
    if not include_archived:
        sql += " AND archived = false"
    sql += " ORDER BY name"
    with open_session() as session:
        rows = [dict(r) for r in session.execute(text(sql), {"w": workspace_id}).mappings()]
        if not rows:
            return rows
        # Attach member user-ids so the sidebar can resolve DM partner names
        # without an N+1 fetch.  We only do it for DM-style channels because
        # public channels can have hundreds of members and the sidebar does
        # not need that information.
        dm_ids = [r["id"] for r in rows if r.get("type") in {"dm", "group_dm"}]
        members_by_channel: dict[str, list[str]] = {}
        if dm_ids:
            mrows = session.execute(
                text(
                    "SELECT channel_id, user_id FROM channel_members "
                    "WHERE channel_id = ANY(:ids) ORDER BY joined_at"
                ),
                {"ids": dm_ids},
            ).mappings()
            for m in mrows:
                members_by_channel.setdefault(m["channel_id"], []).append(m["user_id"])
        for r in rows:
            if r.get("type") in {"dm", "group_dm"}:
                r["members"] = members_by_channel.get(r["id"], [])
        return rows


@function(name="channel:list-members", mcp_expose=True, mcp_scope="read:channels")
def list_channel_members(channel_id: str) -> list[dict[str, Any]]:
    from sqlalchemy import text

    with open_session() as session:
        rows = session.execute(
            text(
                """
                SELECT cm.user_id,
                       COALESCE(u.display_name, cm.user_id) AS display_name,
                       COALESCE(u.is_anonymous, FALSE) AS is_anonymous,
                       cm.role,
                       cm.joined_at
                FROM channel_members cm
                LEFT JOIN users u ON u.user_id = cm.user_id
                WHERE cm.channel_id = :c
                ORDER BY display_name
                """
            ),
            {"c": channel_id},
        ).mappings()
        return [dict(r) for r in rows]
