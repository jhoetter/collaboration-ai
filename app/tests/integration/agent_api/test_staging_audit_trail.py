"""End-to-end: agent send → staging policy → audit trail."""

from __future__ import annotations

from domain.agent_api import mcp_server, registry
from domain.agent_api.audit import ListAuditSink
from domain.agent_api.scopes import AgentIdentity
from domain.shared.command_bus import Command

from ..chat.fixtures import bootstrap


def test_agent_send_in_default_channel_stages() -> None:
    bs = bootstrap()
    # Register the agent identity through the bus so authorisation works.
    bs.bus.dispatch(
        Command(
            type="workspace:invite",
            payload={"user_id": "agent:bot", "role": "member"},
            source="human",
            actor_id=bs.users[0],
            workspace_id=bs.workspace_id,
        )
    )

    registry.reset()

    def chat_send(workspace_id: str, channel_id: str, content: str, *, actor_id: str) -> dict:
        """Send a chat message."""
        return bs.bus.dispatch(
            Command(
                type="chat:send-message",
                payload={"content": content},
                source="agent",
                actor_id=actor_id,
                workspace_id=workspace_id,
                room_id=channel_id,
                agent_id=actor_id,
            )
        ).to_dict()

    registry.register("chat:send-message", chat_send, mcp_expose=True, mcp_scope="write:messages")

    sink = ListAuditSink()
    res = mcp_server.dispatch_tool(
        "chat:send-message",
        {"channel_id": "ch_general", "content": "hello from agent"},
        identity=AgentIdentity(
            agent_id="agent:bot",
            workspace_id=bs.workspace_id,
            scopes=frozenset({"write:messages"}),
        ),
        audit_sink=sink,
    )
    assert res.ok
    # Default channel staging: agent commands stage as proposals.
    assert res.output["status"] == "staged"
    assert sink.records[0].decision == "staged"
    assert any(p["status"] == "pending" for p in bs.state.proposals.values())


def test_agent_send_in_fully_autonomous_channel_commits_directly() -> None:
    bs = bootstrap()
    bs.bus.dispatch(
        Command(
            type="workspace:invite",
            payload={"user_id": "agent:bot", "role": "member"},
            source="human",
            actor_id=bs.users[0],
            workspace_id=bs.workspace_id,
        )
    )
    # Open an autonomous channel directly through the bus.
    bs.bus.dispatch(
        Command(
            type="channel:create",
            payload={
                "name": "autobots",
                "member_ids": [*bs.users, "agent:bot"],
                "staging_policy": "fully-autonomous",
            },
            source="human",
            actor_id=bs.users[0],
            workspace_id=bs.workspace_id,
            room_id="ch_autobots",
        )
    )

    res = bs.bus.dispatch(
        Command(
            type="chat:send-message",
            payload={"content": "auto-send"},
            source="agent",
            actor_id="agent:bot",
            workspace_id=bs.workspace_id,
            room_id="ch_autobots",
            agent_id="agent:bot",
        )
    )
    assert res.status == "applied"
    assert any(e.type == "message.send" for e in res.events)
