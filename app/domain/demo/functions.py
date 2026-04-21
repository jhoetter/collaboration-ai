"""Anonymous-onboarding facade for the standalone web demo.

``demo:onboard`` is what the web UI calls on first load instead of a
login flow: it upserts the caller's anonymous identity into the users
table, joins them to the seeded ``w_demo`` workspace if they aren't
already a member, and adds them to a couple of default channels so
they immediately have somewhere to chat.

Workspace + channel creation happens in ``app/scripts/seed.py``; this
function only handles per-user joining and is idempotent so the same
identity can re-onboard freely (page reloads, refresh, etc.).
"""

from __future__ import annotations

from typing import Any

from ..shared.decorators import function
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus, open_session

DEMO_WORKSPACE_ID = "w_demo"
SYSTEM_USER_ID = "u_system"
DEFAULT_CHANNEL_IDS = ["c_general", "c_random", "c_engineering"]
DEFAULT_LANDING_CHANNEL = "c_general"


@function(name="demo:onboard", mcp_expose=False)
def onboard(user_id: str, display_name: str) -> dict[str, Any]:
    """Make the caller a member of the demo workspace + default channels.

    Returns the IDs the UI needs to land directly in a usable channel.
    Idempotent: callers can re-invoke on every app boot without
    side effects.
    """
    bus = get_command_bus()

    with open_session() as session:
        _upsert_user(session, user_id, display_name)
        needs_workspace_invite = not _is_workspace_member(
            session, DEMO_WORKSPACE_ID, user_id
        )
        already_in_channels = {
            channel_id
            for channel_id in DEFAULT_CHANNEL_IDS
            if _is_channel_member(session, channel_id, user_id)
        }

    if needs_workspace_invite:
        result = bus.dispatch(
            Command(
                type="workspace:invite",
                payload={"user_id": user_id, "role": "member"},
                source="human",
                actor_id=SYSTEM_USER_ID,
                workspace_id=DEMO_WORKSPACE_ID,
            )
        )
        if result.status == "rejected":
            return {
                "user_id": user_id,
                "display_name": display_name,
                "workspace_id": DEMO_WORKSPACE_ID,
                "default_channel_id": DEFAULT_LANDING_CHANNEL,
                "error": result.error.message if result.error else "workspace invite failed",
            }

    for channel_id in DEFAULT_CHANNEL_IDS:
        if channel_id in already_in_channels:
            continue
        bus.dispatch(
            Command(
                type="channel:invite",
                payload={"user_ids": [user_id]},
                source="human",
                actor_id=SYSTEM_USER_ID,
                workspace_id=DEMO_WORKSPACE_ID,
                room_id=channel_id,
            )
        )

    return {
        "user_id": user_id,
        "display_name": display_name,
        "workspace_id": DEMO_WORKSPACE_ID,
        "default_channel_id": DEFAULT_LANDING_CHANNEL,
    }


def _upsert_user(session: Session, user_id: str, display_name: str) -> None:
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


def _is_workspace_member(session: Session, workspace_id: str, user_id: str) -> bool:
    row = session.execute(
        text(
            "SELECT 1 FROM workspace_members WHERE workspace_id = :w AND user_id = :u LIMIT 1"
        ),
        {"w": workspace_id, "u": user_id},
    ).first()
    return row is not None


def _is_channel_member(session: Session, channel_id: str, user_id: str) -> bool:
    row = session.execute(
        text(
            "SELECT 1 FROM channel_members WHERE channel_id = :c AND user_id = :u LIMIT 1"
        ),
        {"c": channel_id, "u": user_id},
    ).first()
    return row is not None
