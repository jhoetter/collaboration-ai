"""drop legacy bridge columns from messages

The Slack/Matrix bridge experiment was removed (see
``spec/bridges/`` deletion). Some local DBs still carry the
``messages.original_author`` / ``messages.imported_from`` columns from
an earlier migration that was rolled back along with the feature.
This migration is a one-shot cleanup that drops them if present so
``hof db migrate`` stops auto-detecting them as drift.

Revision ID: d2c91b4e8a17
Revises: c1a4e2f8b910
Create Date: 2026-04-22
"""
from __future__ import annotations

from typing import Sequence, Union

from alembic import op


revision: str = "d2c91b4e8a17"
down_revision: Union[str, None] = "c1a4e2f8b910"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = __import__("sqlalchemy").inspect(bind)
    cols = {c["name"] for c in inspector.get_columns("messages")}
    if "original_author" in cols:
        op.drop_column("messages", "original_author")
    if "imported_from" in cols:
        op.drop_column("messages", "imported_from")


def downgrade() -> None:
    # The bridges feature is gone; we don't restore the columns on
    # downgrade. If you need them back, recreate via a new migration.
    pass
