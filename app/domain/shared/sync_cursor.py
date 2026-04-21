"""Sync cursor encoding.

A cursor is the client's "I have seen everything up to and including
sequence N in workspace W" claim. Cursors are opaque base64url strings
on the wire; this module is the only place that serialises / parses
them. Keeping it pure means we can fuzz it cheaply.

Format (versioned so we can evolve later without coordinating clients):

    base64url(json({"v": 1, "ws": <workspace_id>, "seq": <int>}))

Old clients always send a `since` query string; missing or unparseable
cursors are treated as "from the start" (sequence 0). The sync route
returns the new cursor in the JSON body so the client can store it
verbatim.
"""

from __future__ import annotations

import base64
import json
from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class SyncCursor:
    workspace_id: str
    sequence: int
    version: int = 1

    def encode(self) -> str:
        raw = json.dumps(
            {"v": self.version, "ws": self.workspace_id, "seq": self.sequence},
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def encode_cursor(workspace_id: str, sequence: int) -> str:
    return SyncCursor(workspace_id=workspace_id, sequence=sequence).encode()


def decode_cursor(cursor: str | None, *, workspace_id: str) -> SyncCursor:
    """Decode a cursor; on any error, fall back to ``sequence=0``."""
    if not cursor:
        return SyncCursor(workspace_id=workspace_id, sequence=0)
    try:
        # Pad back the stripped '=' so urlsafe_b64decode accepts it.
        padded = cursor + "=" * (-len(cursor) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        data = json.loads(raw)
        return SyncCursor(
            workspace_id=str(data.get("ws") or workspace_id),
            sequence=int(data.get("seq", 0)),
            version=int(data.get("v", 1)),
        )
    except (ValueError, json.JSONDecodeError):
        return SyncCursor(workspace_id=workspace_id, sequence=0)


def advance(cursor: SyncCursor, max_sequence: int) -> SyncCursor:
    """Return a new cursor advanced to the highest seen sequence."""
    if max_sequence <= cursor.sequence:
        return cursor
    return SyncCursor(
        workspace_id=cursor.workspace_id,
        sequence=max_sequence,
        version=cursor.version,
    )
