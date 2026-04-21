"""Agent + proposal projections."""

from __future__ import annotations

from hof import Column, Table, types


class Agent(Table):
    __tablename__ = "agents"

    agent_id = Column(types.Text, required=True, primary_key=True)
    workspace_id = Column(types.Text, required=True, indexed=True)
    display_name = Column(types.Text, required=True)
    scopes = Column(types.JSON, required=True, default=list)
    registered_at = Column(types.BigInteger, required=True)
    registered_by = Column(types.Text, required=True)


class Proposal(Table):
    __tablename__ = "proposals"

    proposal_id = Column(types.Text, required=True, primary_key=True)
    workspace_id = Column(types.Text, required=True, indexed=True)
    channel_id = Column(types.Text, required=True, indexed=True)
    agent_id = Column(types.Text, nullable=True)
    command_type = Column(types.Text, required=True)
    payload = Column(types.JSON, required=True)
    rationale = Column(types.Text, nullable=True)
    status = Column(types.String, required=True, default="pending")
    created_at = Column(types.BigInteger, required=True)
    resolved_at = Column(types.BigInteger, nullable=True)
    resolved_by = Column(types.Text, nullable=True)
    reject_reason = Column(types.Text, nullable=True)
    edited_payload = Column(types.JSON, nullable=True)
