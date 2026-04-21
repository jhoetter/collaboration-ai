"""Agent identity + proposal lifecycle endpoints.

The propose / approve / reject / edit-and-approve commands flow through
the same command bus as everything else; these `@function`s are thin
adapters used by the `collab-agent` CLI and the MCP server.
"""

from __future__ import annotations

from typing import Any

from hof import function
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..shared.command_bus import Command
from ..shared.runtime import get_command_bus


@function(name="agent:propose-message", mcp_expose=True, mcp_scope="propose:message")
def propose_message(
    workspace_id: str,
    channel_id: str,
    content: str,
    *,
    rationale: str | None = None,
    thread_root: str | None = None,
    mentions: list[str] | None = None,
    attachments: list[dict[str, Any]] | None = None,
    actor_id: str,
    agent_id: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    payload: dict[str, Any] = {"content": content, "channel_id": channel_id}
    if rationale is not None:
        payload["rationale"] = rationale
    if thread_root is not None:
        payload["thread_root"] = thread_root
    if mentions:
        payload["mentions"] = mentions
    if attachments:
        payload["attachments"] = attachments
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="agent:propose-message",
            payload=payload,
            source="agent",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
            agent_id=agent_id,
            idempotency_key=idempotency_key,
        )
    ).to_dict()


@function(name="agent:approve-proposal", mcp_expose=True, mcp_scope="approve:proposal")
def approve_proposal(
    workspace_id: str,
    proposal_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="agent:approve-proposal",
            payload={"proposal_id": proposal_id},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="agent:reject-proposal", mcp_expose=True, mcp_scope="approve:proposal")
def reject_proposal(
    workspace_id: str,
    proposal_id: str,
    *,
    reason: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="agent:reject-proposal",
            payload={"proposal_id": proposal_id, "reason": reason},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="agent:edit-and-approve-proposal", mcp_expose=True, mcp_scope="approve:proposal")
def edit_and_approve_proposal(
    workspace_id: str,
    proposal_id: str,
    edited_payload: dict[str, Any],
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="agent:edit-and-approve-proposal",
            payload={"proposal_id": proposal_id, "edited_payload": edited_payload},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
        )
    ).to_dict()


@function(name="agent:list-proposals", mcp_expose=True, mcp_scope="read:proposals")
def list_proposals(
    workspace_id: str,
    *,
    channel_id: str | None = None,
    status: str = "pending",
    session: Session,
) -> list[dict[str, Any]]:
    sql = "SELECT * FROM proposals WHERE workspace_id = :w AND status = :status"
    params: dict[str, Any] = {"w": workspace_id, "status": status}
    if channel_id is not None:
        sql += " AND channel_id = :ch"
        params["ch"] = channel_id
    sql += " ORDER BY created_at DESC LIMIT 200"
    rows = session.execute(text(sql), params).mappings()
    return [dict(r) for r in rows]
