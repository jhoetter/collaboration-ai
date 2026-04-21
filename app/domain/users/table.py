"""Projection table for user display names.

Anonymous demo identities live here so the web UI can render
``display_name`` instead of an opaque ``user_id`` for messages it
receives over the WebSocket. The host (hof-os) will replace this with
its own user table once integration lands.

Note on primary keys: hof's ``Table`` always injects an internal
``id`` UUID PK. We therefore can't use ``primary_key=True`` on our
natural keys (``user_id``, ``workspace_id``, …) — that would build a
composite PK and break the projection writer's
``ON CONFLICT (natural_key)`` upserts. We use ``unique=True`` instead,
which gives us the constraint without disturbing hof's auto-PK.
"""

from __future__ import annotations

from hof import Column, Table, types


class User(Table):
    __tablename__ = "users"

    user_id = Column(types.Text, required=True, unique=True)
    display_name = Column(types.Text, required=True)
    is_anonymous = Column(types.Boolean, required=True, default=True)
