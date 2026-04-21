"""HTTP / CLI surface for the events log.

These ``@function`` endpoints expose **read-only** access to the
event log. Mutations always go through their entity-specific commands
(``chat:send-message`` etc.), which are themselves ``@function``
endpoints in ``app/domain/<entity>/functions.py``.
"""

from __future__ import annotations

from typing import Any

from hof import function
from sqlalchemy.orm import Session

from .repository import stream_events


@function(name="events:list", mcp_expose=True, mcp_scope="read:events")
def list_events(
    workspace_id: str,
    since_sequence: int = 0,
    limit: int = 200,
    *,
    session: Session,
) -> list[dict[str, Any]]:
    """Return up to ``limit`` events newer than ``since_sequence``.

    The agent API + the replay tool both call this. The web UI uses the
    higher-level ``/api/sync`` route which adds presence and typing
    deltas on top of the raw events.
    """
    return [evt.to_dict() for evt in stream_events(session, workspace_id=workspace_id, since_sequence=since_sequence, limit=limit)]


@function(name="events:replay-state", mcp_expose=False)
def replay_state(workspace_id: str, *, session: Session) -> dict[str, Any]:
    """Replay the entire log for a workspace and return a summary of the
    projected state. Used by ``make replay-check`` to verify
    determinism.
    """
    from .projector import project_log

    events = list(stream_events(session, workspace_id=workspace_id, since_sequence=0, limit=10_000_000))
    state = project_log(events)
    return {
        "workspace_id": workspace_id,
        "events_replayed": len(events),
        "channels": len(state.channels),
        "messages": len(state.messages),
        "members": sum(len(m) for m in state.workspace_members.values()),
        "proposals_pending": sum(1 for p in state.proposals.values() if p["status"] == "pending"),
        "last_sequence": state.last_sequence.get(workspace_id, 0),
    }


def get_projected_state(workspace_id: str):
    """Return a freshly-projected `ProjectedState` for ``workspace_id``.

    The runtime keeps a per-workspace cache invalidated on every
    committed event; this helper is the simple, always-correct path used
    by read endpoints + tests. The hot path is implemented in the
    projector worker and serves the cached result directly.
    """
    from ..shared.runtime import get_session_factory
    from .projector import project_log

    SessionLocal = get_session_factory()
    with SessionLocal() as session:
        events = list(
            stream_events(session, workspace_id=workspace_id, since_sequence=0, limit=10_000_000)
        )
    return project_log(events)
