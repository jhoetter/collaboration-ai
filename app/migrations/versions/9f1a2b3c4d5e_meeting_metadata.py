"""meeting metadata: recording_url, transcript_url, ended_reason

Adds optional metadata columns to ``huddles`` so completed meetings can
carry recording / transcript pointers (Phase 6 — not yet wired) and an
``ended_reason`` discriminator (``host_ended``, ``auto_ended``, …) used
by the past-meetings UI to explain *why* a meeting closed.  All columns
are nullable; nothing in the current write path depends on them yet.

Revision ID: 9f1a2b3c4d5e
Revises: 6831398101c6
Create Date: 2026-04-23
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "9f1a2b3c4d5e"
down_revision: Union[str, None] = "6831398101c6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _huddle_columns() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("huddles")}


def upgrade() -> None:
    cols = _huddle_columns()
    if "recording_url" not in cols:
        op.add_column("huddles", sa.Column("recording_url", sa.Text(), nullable=True))
    if "transcript_url" not in cols:
        op.add_column("huddles", sa.Column("transcript_url", sa.Text(), nullable=True))
    if "ended_reason" not in cols:
        op.add_column("huddles", sa.Column("ended_reason", sa.String(length=32), nullable=True))


def downgrade() -> None:
    cols = _huddle_columns()
    if "ended_reason" in cols:
        op.drop_column("huddles", "ended_reason")
    if "transcript_url" in cols:
        op.drop_column("huddles", "transcript_url")
    if "recording_url" in cols:
        op.drop_column("huddles", "recording_url")
