"""Entry point for the `collabai-mcp` console script."""

from __future__ import annotations

import os

from .audit import ListAuditSink
from .registry import import_from_hof_registry
from .scopes import AgentIdentity
from .stdio import serve_stdio


def main() -> None:  # pragma: no cover
    import_from_hof_registry()
    identity = AgentIdentity(
        agent_id=os.environ.get("COLLABAI_AGENT_ID", "agent:cli"),
        workspace_id=os.environ.get("COLLABAI_WORKSPACE_ID", ""),
        scopes=frozenset(os.environ.get("COLLABAI_AGENT_SCOPES", "read:messages,write:messages").split(",")),
    )
    serve_stdio(identity=identity, sink=ListAuditSink())


if __name__ == "__main__":  # pragma: no cover
    main()
