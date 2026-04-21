"""Projection tables for workspaces and their members."""

from __future__ import annotations

from hof import Column, Table, types


class Workspace(Table):
    __tablename__ = "workspaces"

    workspace_id = Column(types.Text, required=True, primary_key=True)
    name = Column(types.Text, required=True)
    slug = Column(types.Text, unique=True, nullable=True)
    icon = Column(types.Text, nullable=True)
    created_at = Column(types.BigInteger, required=True)
    created_by = Column(types.Text, required=True)


class WorkspaceMember(Table):
    __tablename__ = "workspace_members"

    workspace_id = Column(types.Text, required=True, primary_key=True)
    user_id = Column(types.Text, required=True, primary_key=True)
    role = Column(types.String, required=True, default="member")
    joined_at = Column(types.BigInteger, required=True)
