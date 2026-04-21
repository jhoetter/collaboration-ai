"""Projection table for user display names.

Anonymous demo identities live here so the web UI can render
``display_name`` instead of an opaque ``user_id`` for messages it
receives over the WebSocket. The host (hof-os) will replace this with
its own user table once integration lands.
"""

from __future__ import annotations

from hof import Column, Table, types


class User(Table):
    __tablename__ = "users"

    user_id = Column(types.Text, required=True, primary_key=True)
    display_name = Column(types.Text, required=True)
    is_anonymous = Column(types.Boolean, required=True, default=True)
