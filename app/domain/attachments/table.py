"""Attachment metadata projection (S3 holds the bytes)."""

from __future__ import annotations

from hof import Column, Table, types


class Attachment(Table):
    __tablename__ = "attachments"

    file_id = Column(types.Text, required=True, primary_key=True)
    workspace_id = Column(types.Text, required=True, index=True)
    uploaded_by = Column(types.Text, required=True)
    object_key = Column(types.Text, required=True)
    mime = Column(types.Text, required=True)
    size_bytes = Column(types.BigInteger, required=True)
    width = Column(types.Integer, nullable=True)
    height = Column(types.Integer, nullable=True)
    thumbnail_key = Column(types.Text, nullable=True)
    virus_scan_status = Column(types.String, required=True, default="pending")
    created_at = Column(types.BigInteger, required=True)
