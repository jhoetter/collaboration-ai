"""hof-engine flow registrations for Slack import and Matrix poll.

The pure logic lives in `slack/importer.py` and `matrix/importer.py`;
these wrappers exist so operators can run imports as background jobs
from the admin UI / `hofos collab bridges` CLI.
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from hof import flow

from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus
from .matrix.client import MatrixCreds, fetch_sync
from .matrix.importer import normalise_sync
from .protocol import bridge_agent_id
from .slack.importer import ImportState, import_export


def _bus_dispatch(workspace_id: str, command_type: str, payload: dict[str, Any]) -> None:
    """Dispatch through the workspace command bus as the synthetic bridge user."""
    provider = "slack" if command_type.startswith("channel:") or "slack" in payload.get("metadata", {}).get("bridge", "") else "matrix"
    bus = get_command_bus()
    bus.dispatch(
        Command(
            type=command_type,
            payload=payload,
            source="agent",
            actor_id=bridge_agent_id(provider),
            workspace_id=workspace_id,
        )
    )


@flow(name="bridges:slack-import")
def slack_import_flow(workspace_id: str, export_path: str) -> dict[str, Any]:
    """Background flow: import a Slack export zip into archive channels.

    Idempotent on `(workspace_id, export hash)` thanks to
    `ImportState`; re-running with the same zip is a no-op.
    """
    state = ImportState()  # TODO: persist between runs in a Table
    result = import_export(
        workspace_id,
        Path(export_path),
        state=state,
        dispatch=lambda cmd, payload: _bus_dispatch(workspace_id, cmd, payload),
    )
    return {
        "channels_created": result.channels_created,
        "messages_imported": result.messages_imported,
        "messages_skipped": result.messages_skipped,
        "errors": result.errors,
    }


@flow(name="bridges:matrix-poll")
def matrix_poll_flow(
    workspace_id: str,
    homeserver: str,
    access_token: str,
    since: str | None = None,
    room_names: dict[str, str] | None = None,
) -> dict[str, Any]:
    """One-shot poll. Celery beat schedules this every 30s per workspace."""
    import httpx

    creds = MatrixCreds(homeserver=homeserver, access_token=access_token)

    def _http(url: str, *, params: dict[str, str], headers: dict[str, str]) -> dict[str, Any]:
        resp = httpx.get(url, params=params, headers=headers, timeout=20.0)
        resp.raise_for_status()
        return resp.json()

    response = fetch_sync(creds, since=since, http=_http)
    events = list(normalise_sync(response, room_names=room_names or {}))
    for ev in events:
        _bus_dispatch(
            workspace_id,
            "chat:send-message",
            {
                "workspace_id": workspace_id,
                "channel_name": f"matrix-archive/{ev.external_channel_name}",
                "content": ev.text,
                "sender_id": bridge_agent_id("matrix"),
                "sender_type": "system",
                "metadata": {
                    "bridge": "matrix",
                    "external_message_id": ev.external_message_id,
                    "external_user_id": ev.external_user_id,
                    "external_ts": ev.external_ts,
                },
            },
        )
    return {"next_batch": response.next_batch, "imported": len(events)}
