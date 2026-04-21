"""Projection tables for workspaces and their members."""

from __future__ import annotations

from hof import Column, Table, types
from sqlalchemy import BigInteger, UniqueConstraint


class Workspace(Table):
    __tablename__ = "workspaces"

    workspace_id = Column(types.Text, required=True, unique=True)
    name = Column(types.Text, required=True)
    slug = Column(types.Text, unique=True, nullable=True)
    icon = Column(types.Text, nullable=True)
    created_at = Column(BigInteger, required=True)
    created_by = Column(types.Text, required=True)


class WorkspaceMember(Table):
    __tablename__ = "workspace_members"
    __table_args__ = (
        UniqueConstraint("workspace_id", "user_id", name="ux_workspace_members_wid_uid"),
    )

    workspace_id = Column(types.Text, required=True, index=True)
    user_id = Column(types.Text, required=True, index=True)
    role = Column(types.String, required=True, default="member")
    joined_at = Column(BigInteger, required=True)
