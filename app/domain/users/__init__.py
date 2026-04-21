"""Lightweight user registry.

Real auth + identity is intentionally deferred — when collaboration-ai is
mounted into hof-os the host will own user management. This module only
exists so the standalone web demo can attach an opaque ``user_id`` to a
human-readable ``display_name`` (e.g. "Anonymous Bear") and so the UI
has somewhere to look up sender names for incoming messages.
"""

from __future__ import annotations

from .table import User

__all__ = ["User"]
