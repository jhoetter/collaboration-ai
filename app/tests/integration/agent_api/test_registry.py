"""Function registry → MCP tool descriptors."""

from __future__ import annotations

import pytest

from domain.agent_api import registry


def _send_message(workspace_id: str, channel_id: str, content: str, *, actor_id: str) -> dict:
    """Send a chat message in the given channel."""
    return {"command_id": "x", "status": "applied", "events": []}


def _list_messages(channel_id: str, since_sequence: int = 0, limit: int = 100) -> list[dict]:
    """Return up to `limit` recent messages from a channel."""
    return []


@pytest.fixture(autouse=True)
def _reset() -> None:
    registry.reset()


def test_register_extracts_signature_and_doc() -> None:
    entry = registry.register(
        "chat:send-message", _send_message, mcp_expose=True, mcp_scope="write:messages"
    )
    assert entry.docstring.startswith("Send")
    schema = entry.input_schema
    assert "workspace_id" in schema["properties"]
    assert "channel_id" in schema["properties"]
    assert "content" in schema["properties"]
    assert set(schema["required"]) >= {"workspace_id", "channel_id", "content", "actor_id"}


def test_optional_args_not_in_required() -> None:
    entry = registry.register(
        "chat:list-messages", _list_messages, mcp_expose=True, mcp_scope="read:messages"
    )
    assert entry.input_schema["properties"]["since_sequence"]["type"] == "integer"
    assert "since_sequence" not in entry.input_schema.get("required", [])


def test_only_mcp_exposed_in_mcp_entries() -> None:
    registry.register("a", _send_message, mcp_expose=True, mcp_scope="x")
    registry.register("b", _send_message, mcp_expose=False, mcp_scope=None)
    names = {e.name for e in registry.mcp_entries()}
    assert names == {"a"}
