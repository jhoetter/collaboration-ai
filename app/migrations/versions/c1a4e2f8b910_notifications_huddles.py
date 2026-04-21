"""notifications + huddles tables

Revision ID: c1a4e2f8b910
Revises: ba3365dfe1df
Create Date: 2026-04-21 23:00:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c1a4e2f8b910"
down_revision: Union[str, None] = "ba3365dfe1df"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "notifications",
        sa.Column("notification_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("workspace_id", sa.Text(), nullable=False),
        sa.Column("channel_id", sa.Text(), nullable=True),
        sa.Column("kind", sa.String(length=64), nullable=False),
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
    op.create_index(op.f("ix_notifications_user_id"), "notifications", ["user_id"], unique=False)
    op.create_index(
        op.f("ix_notifications_workspace_id"),
        "notifications",
        ["workspace_id"],
        unique=False,
    )

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
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("huddle_id"),
    )
    op.create_index(op.f("ix_huddles_channel_id"), "huddles", ["channel_id"], unique=False)
    op.create_index(op.f("ix_huddles_workspace_id"), "huddles", ["workspace_id"], unique=False)

    op.create_table(
        "huddle_participants",
        sa.Column("huddle_id", sa.Text(), nullable=False),
        sa.Column("user_id", sa.Text(), nullable=False),
        sa.Column("joined_at", sa.BigInteger(), nullable=False),
        sa.Column("left_at", sa.BigInteger(), nullable=True),
        sa.Column("role", sa.String(length=32), nullable=False),
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=True,
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("huddle_id", "user_id", name="ux_huddle_participants_hid_uid"),
    )
    op.create_index(
        op.f("ix_huddle_participants_huddle_id"),
        "huddle_participants",
        ["huddle_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_huddle_participants_huddle_id"), table_name="huddle_participants")
    op.drop_table("huddle_participants")
    op.drop_index(op.f("ix_huddles_workspace_id"), table_name="huddles")
    op.drop_index(op.f("ix_huddles_channel_id"), table_name="huddles")
    op.drop_table("huddles")
    op.drop_index(op.f("ix_notifications_workspace_id"), table_name="notifications")
    op.drop_index(op.f("ix_notifications_user_id"), table_name="notifications")
    op.drop_table("notifications")
