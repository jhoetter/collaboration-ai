"""Workspace `@function` endpoints — thin wrappers around the command bus."""

from __future__ import annotations

from typing import Any

from hof import function

from ..events.ids import make_workspace_id
from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus


@function(name="workspace:create", mcp_expose=True, mcp_scope="write:workspaces")
def create_workspace(
    name: str,
    *,
    slug: str | None = None,
    icon: str | None = None,
    actor_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    workspace_id = make_workspace_id(slug)
    bus = get_command_bus()
    cmd = Command(
        type="workspace:create",
        payload={"name": name, **({"slug": slug} if slug else {}), **({"icon": icon} if icon else {})},
        source="human",
        actor_id=actor_id,
        workspace_id=workspace_id,
        idempotency_key=idempotency_key,
    )
    return bus.dispatch(cmd).to_dict()


@function(name="workspace:invite", mcp_expose=True, mcp_scope="write:workspaces")
def invite(
    workspace_id: str,
    user_id: str,
    role: str = "member",
    *,
    actor_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="workspace:invite",
            payload={"user_id": user_id, "role": role},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="workspace:set-role", mcp_expose=True, mcp_scope="write:workspaces")
def set_role(
    workspace_id: str,
    user_id: str,
    role: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="workspace:set-role",
            payload={"user_id": user_id, "role": role},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()
