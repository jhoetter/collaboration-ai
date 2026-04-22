"""recover huddles + notifications tables (idempotent)

A previous broken autogenerate run dropped the ``huddles``,
``huddle_participants`` and ``notifications`` tables on local DBs that
had already applied ``c1a4e2f8b910``. This migration restores them
*if and only if* they are missing, so it is safe both for the original
fresh-install path (tables already exist → no-op) and for any
developer DB caught in the broken intermediate state.

Revision ID: 6831398101c6
Revises: d2c91b4e8a17
Create Date: 2026-04-22
"""
from __future__ import annotations

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "6831398101c6"
down_revision: Union[str, None] = "d2c91b4e8a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _existing_tables() -> set[str]:
    return set(sa.inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    tables = _existing_tables()

    if "huddles" not in tables:
        op.create_table(
            "huddles",
            sa.Column("huddle_id", sa.Text(), nullable=False),
            sa.Column("workspace_id", sa.Text(), nullable=False),
            sa.Column("channel_id", sa.Text(), nullable=False),
            sa.Column("livekit_room", sa.Text(), nullable=False),
            sa.Column("started_by", sa.Text(), nullable=False),
            sa.Column("started_at", sa.BigInteger(), nullable=False),
            sa.Column("ended_at", sa.BigInteger(), nullable=True),
            sa.Column("title", sa.Text(), nullable=True),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("huddle_id"),
        )
        op.create_index(
            op.f("ix_huddles_channel_id"), "huddles", ["channel_id"], unique=False
        )
        op.create_index(
            op.f("ix_huddles_workspace_id"), "huddles", ["workspace_id"], unique=False
        )

    if "huddle_participants" not in tables:
        op.create_table(
            "huddle_participants",
            sa.Column("huddle_id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Text(), nullable=False),
            sa.Column("joined_at", sa.BigInteger(), nullable=False),
            sa.Column("left_at", sa.BigInteger(), nullable=True),
            sa.Column("role", sa.String(length=255), nullable=False),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "huddle_id", "user_id", name="ux_huddle_participants_hid_uid"
            ),
        )
        op.create_index(
            op.f("ix_huddle_participants_huddle_id"),
            "huddle_participants",
            ["huddle_id"],
            unique=False,
        )

    if "notifications" not in tables:
        op.create_table(
            "notifications",
            sa.Column("notification_id", sa.Text(), nullable=False),
            sa.Column("user_id", sa.Text(), nullable=False),
            sa.Column("workspace_id", sa.Text(), nullable=False),
            sa.Column("channel_id", sa.Text(), nullable=True),
            sa.Column("kind", sa.String(length=255), nullable=False),
            sa.Column("target_event_id", sa.Text(), nullable=True),
            sa.Column("body", sa.Text(), nullable=True),
            sa.Column("created_at", sa.BigInteger(), nullable=False),
            sa.Column("read_at", sa.BigInteger(), nullable=True),
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=True,
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("notification_id"),
        )
        op.create_index(
            op.f("ix_notifications_user_id"),
            "notifications",
            ["user_id"],
            unique=False,
        )
        op.create_index(
            op.f("ix_notifications_workspace_id"),
            "notifications",
            ["workspace_id"],
            unique=False,
        )


def downgrade() -> None:
    # Recovery migration: do not undo on downgrade — the original
    # creators are c1a4e2f8b910.
    pass
