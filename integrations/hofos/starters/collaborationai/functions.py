"""Public `@function` shells exposed by hof-os.

Each function is a thin proxy to the sidecar. They live on the host
side (not in the sidecar) so that hof-os tenants can mention them in
their flows / prompts without having to know about the sidecar URL or
auth model.
"""

from __future__ import annotations

from typing import Any

from hof import function

from .client import CollabClient


@function(name="collab:send-message", mcp_expose=True, mcp_scope="write:messages")
def collab_send_message(
    workspace_id: str,
    channel: str,
    content: str,
    *,
    mention_users: list[str] | None = None,
) -> dict[str, Any]:
    """Post a message to a collaboration-ai channel as the tenant bot."""
    return CollabClient.from_env().call(
        "chat:send-message",
        {
            "workspace_id": workspace_id,
            "channel_name": channel,
            "content": content,
            "mentions": mention_users or [],
            "sender_type": "system",
        },
    )


@function(name="collab:open-thread", mcp_expose=True, mcp_scope="read:messages")
def collab_open_thread(
    workspace_id: str,
    channel: str,
    root_message_id: str,
) -> dict[str, Any]:
    """Return a deep link to a thread in the web UI."""
    return CollabClient.from_env().call(
        "threads:permalink",
        {
            "workspace_id": workspace_id,
            "channel_name": channel,
            "root_message_id": root_message_id,
        },
    )


@function(name="collab:request-agent-approval", mcp_expose=True, mcp_scope="write:agent-stage")
def collab_request_agent_approval(
    workspace_id: str,
    channel: str,
    command_type: str,
    payload: dict[str, Any],
    *,
    agent_id: str,
    ttl_minutes: int = 60,
) -> dict[str, Any]:
    """Stage a command for human approval via the agent inbox."""
    return CollabClient.from_env().call(
        "agent:stage-command",
        {
            "workspace_id": workspace_id,
            "channel_name": channel,
            "command_type": command_type,
            "payload": payload,
            "agent_id": agent_id,
            "ttl_minutes": ttl_minutes,
        },
    )
