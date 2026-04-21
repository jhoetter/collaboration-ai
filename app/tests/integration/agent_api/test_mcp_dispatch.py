"""MCP dispatch with scope checks + audit."""

from __future__ import annotations

import pytest

from domain.agent_api import mcp_server, registry
from domain.agent_api.audit import ListAuditSink
from domain.agent_api.scopes import AgentIdentity


def _send_message(workspace_id: str, channel_id: str, content: str, *, actor_id: str) -> dict:
    """Send a chat message."""
    return {
        "command_id": "cmd_42",
        "status": "applied",
        "events": [{"event_id": "evt_1"}, {"event_id": "evt_2"}],
    }


def _list_unread(workspace_id: str, *, actor_id: str) -> list[dict]:
    """Return per-channel unread counts."""
    return [{"channel_id": "ch_general", "unread": 3, "mention_count": 1}]


@pytest.fixture(autouse=True)
def _reset() -> None:
    registry.reset()
    registry.register(
        "chat:send-message", _send_message, mcp_expose=True, mcp_scope="write:messages"
    )
    registry.register(
        "unread:by-channel", _list_unread, mcp_expose=True, mcp_scope="read:messages"
    )


def _identity(scopes: set[str]) -> AgentIdentity:
    return AgentIdentity(agent_id="agent:bot", workspace_id="ws_demo", scopes=frozenset(scopes))


def test_dispatch_with_required_scope_succeeds() -> None:
    sink = ListAuditSink()
    res = mcp_server.dispatch_tool(
        "chat:send-message",
        {"channel_id": "ch_general", "content": "hi"},
        identity=_identity({"write:messages"}),
        audit_sink=sink,
    )
    assert res.ok
    assert res.output["command_id"] == "cmd_42"
    assert res.audit and res.audit.event_ids == ["evt_1", "evt_2"]
    assert sink.records[0].agent_id == "agent:bot"


def test_dispatch_without_scope_is_denied() -> None:
    sink = ListAuditSink()
    res = mcp_server.dispatch_tool(
        "chat:send-message",
        {"channel_id": "ch_general", "content": "hi"},
        identity=_identity({"read:messages"}),
        audit_sink=sink,
    )
    assert res.ok is False
    assert res.output == {"error": "scope_denied", "required_scope": "write:messages"}
    assert sink.records == []  # no audit because no command was dispatched


def test_dispatch_unknown_tool_returns_error() -> None:
    sink = ListAuditSink()
    res = mcp_server.dispatch_tool(
        "does:not-exist",
        {},
        identity=_identity({"read:messages"}),
        audit_sink=sink,
    )
    assert res.ok is False
    assert res.output["error"] == "unknown_tool"


def test_dispatch_injects_actor_id_and_workspace_id_from_identity() -> None:
    sink = ListAuditSink()
    res = mcp_server.dispatch_tool(
        "unread:by-channel",
        {},
        identity=_identity({"read:messages"}),
        audit_sink=sink,
    )
    assert res.ok
    assert res.output[0]["channel_id"] == "ch_general"
    assert sink.records[0].arguments["actor_id"] == "agent:bot"
    assert sink.records[0].arguments["workspace_id"] == "ws_demo"


def test_list_tools_excludes_non_exposed() -> None:
    registry.register("internal:thing", lambda: 1, mcp_expose=False, mcp_scope=None)
    tools = mcp_server.list_tools()
    names = {t.name for t in tools}
    assert "internal:thing" not in names
    assert "chat:send-message" in names
