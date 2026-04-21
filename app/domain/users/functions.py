"""User registry `@function` endpoints.

Only two operations are exposed today:

* ``users:upsert-anonymous`` — used by the web UI on first load to make
  its locally-generated anonymous identity addressable from other
  browsers (so they can resolve a ``sender_id`` to a display name).
* ``users:list`` — returns every user that currently belongs to a given
  workspace, joined with the user registry. The UI seeds its display-
  name directory from this on boot and refreshes it whenever a message
  arrives from an unknown ``sender_id``.

There is no event-sourcing here on purpose: anonymous identities are
disposable per-browser and don't need an audit trail. When hof-os mounts
this app it will own user identity; these endpoints become a no-op
shim at that point.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import text

from ..shared.command_bus import Command
from ..shared.decorators import function
from ..shared.runtime import get_command_bus, open_session


@function(name="users:upsert-anonymous", mcp_expose=False)
def upsert_anonymous(
    user_id: str,
    display_name: str,
) -> dict[str, Any]:
    """Idempotently register an anonymous browser identity.

    Re-running with the same ``user_id`` updates the display name in
    place; a brand-new ``user_id`` is inserted as a fresh anonymous
    user. Either way the row's ``is_anonymous`` flag stays ``true``.
    """
    with open_session() as session:
        session.execute(
            text(
                """
                INSERT INTO users (id, user_id, display_name, is_anonymous)
                VALUES (gen_random_uuid(), :user_id, :display_name, TRUE)
                ON CONFLICT (user_id) DO UPDATE
                  SET display_name = EXCLUDED.display_name
                """
            ),
            {"user_id": user_id, "display_name": display_name},
        )
        session.commit()
    return {"user_id": user_id, "display_name": display_name, "is_anonymous": True}


@function(name="users:set-display-name", mcp_expose=False)
def set_display_name(
    display_name: str,
    *,
    workspace_id: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    """Update the user's stored display name and emit a
    ``user.display-name.set`` event so projections stay in sync.

    Workspace context is optional — a fresh anonymous browser writes
    its name before joining a workspace; the event is then skipped and
    only the SQL row is touched. Once the user is in a workspace the
    update is also dispatched through the command bus.
    """
    with open_session() as session:
        session.execute(
            text(
                """
                INSERT INTO users (id, user_id, display_name, is_anonymous)
                VALUES (gen_random_uuid(), :user_id, :display_name, TRUE)
                ON CONFLICT (user_id) DO UPDATE
                  SET display_name = EXCLUDED.display_name
                """
            ),
            {"user_id": actor_id, "display_name": display_name},
        )
        session.commit()
    if workspace_id:
        bus = get_command_bus()
        bus.dispatch(
            Command(
                type="user:set-display-name",
                payload={"display_name": display_name},
                source="human",
                actor_id=actor_id,
                workspace_id=workspace_id,
                room_id=workspace_id,
            )
        )
    return {"user_id": actor_id, "display_name": display_name}


@function(name="users:set-status", mcp_expose=True, mcp_scope="write:users")
def set_status(
    workspace_id: str,
    *,
    emoji: str | None = None,
    status_text: str | None = None,
    clear_at: int | None = None,
    actor_id: str,
) -> dict[str, Any]:
    payload: dict[str, Any] = {}
    if emoji is not None:
        payload["emoji"] = emoji
    if status_text is not None:
        payload["text"] = status_text
    if clear_at is not None:
        payload["clear_at"] = clear_at
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="user:set-status",
            payload=payload,
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=workspace_id,
        )
    ).to_dict()


@function(name="users:set-presence", mcp_expose=False)
def set_presence(
    workspace_id: str,
    status: str,
    *,
    until: int | None = None,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="user:set-presence",
            payload={"status": status, **({"until": until} if until is not None else {})},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=workspace_id,
        )
    ).to_dict()


@function(name="users:list", mcp_expose=True, mcp_scope="read:users")
def list_users(workspace_id: str) -> list[dict[str, Any]]:
    """Return every workspace member with their display name.

    Members without a row in the ``users`` table fall back to their
    ``user_id`` — that's the case for users created by the seed (e.g.
    ``u_system``) or by other workspaces' invites.
    """
    with open_session() as session:
        rows = session.execute(
            text(
                """
                SELECT wm.user_id,
                       COALESCE(u.display_name, wm.user_id) AS display_name,
                       COALESCE(u.is_anonymous, FALSE) AS is_anonymous,
                       wm.role
                FROM workspace_members wm
                LEFT JOIN users u ON u.user_id = wm.user_id
                WHERE wm.workspace_id = :w
                ORDER BY display_name
                """
            ),
            {"w": workspace_id},
        ).mappings()
        return [dict(r) for r in rows]
