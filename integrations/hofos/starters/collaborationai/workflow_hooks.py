"""Ergonomic helpers for use inside hof-engine flows.

These wrap the public `@function` shells so flow authors don't have
to remember the payload keys. Keep this module small — anything more
complex should live as its own `@function` so it's exposed to agents
too.
"""

from __future__ import annotations

from typing import Any

from .functions import collab_send_message


def notify_workflow_complete(
    workspace_id: str,
    channel: str,
    workflow_name: str,
    summary: str,
    *,
    mention_users: list[str] | None = None,
) -> dict[str, Any]:
    """Post a "workflow X done" message into the right channel.

    The single most common integration call from data-app flows;
    factored into a named helper so the flow code reads as intent
    instead of payload assembly.
    """
    body = f"*{workflow_name}* finished.\n{summary}"
    return collab_send_message(
        workspace_id,
        channel,
        body,
        mention_users=mention_users,
    )
