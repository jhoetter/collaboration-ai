"""Stable id helpers.

UUIDv7-flavoured ids: 48 bits of millisecond timestamp + 80 random bits.
The on-the-wire string ordering matches creation-time ordering, which is
useful for cursor-style paging and for keeping ``relates_to`` chains
visually grouped in logs without needing the server's ``sequence``.

Pure stdlib; no external deps. We deliberately don't depend on the
``uuid7`` package — keeping this module free of runtime imports means the
projection tests can be run without installing the world.
"""

from __future__ import annotations

import os
import time
from binascii import hexlify


def now_ms() -> int:
    """Server wall-clock in milliseconds. Single source of truth for tests
    that monkeypatch with ``freezegun``."""
    return int(time.time() * 1000)


def make_uuid7(ts_ms: int | None = None) -> str:
    """Build a UUIDv7-shaped string (8-4-4-4-12 hex)."""
    ts = ts_ms if ts_ms is not None else now_ms()
    ts &= (1 << 48) - 1
    rand = os.urandom(10)
    rand_hex = hexlify(rand).decode("ascii")
    ts_hex = format(ts, "012x")
    # version=7, variant=10
    rand_a = format((int(rand_hex[0:3], 16) & 0x0FFF) | 0x7000, "04x")
    rand_b = format((int(rand_hex[3:7], 16) & 0x3FFF) | 0x8000, "04x")
    return f"{ts_hex[0:8]}-{ts_hex[8:12]}-{rand_a}-{rand_b}-{rand_hex[7:19]}"


def make_event_id() -> str:
    return f"evt_{make_uuid7()}"


def make_command_id() -> str:
    return f"cmd_{make_uuid7()}"


def make_proposal_id() -> str:
    return f"prop_{make_uuid7()}"


def make_workspace_id(slug: str | None = None) -> str:
    base = make_uuid7()
    return f"ws_{slug + '_' if slug else ''}{base[:8]}"


def make_channel_id() -> str:
    return f"ch_{make_uuid7()}"


def make_user_id() -> str:
    return f"usr_{make_uuid7()}"


def make_agent_id(label: str) -> str:
    safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in label)
    return f"agent:{safe}"


def make_notification_id() -> str:
    return f"notif_{make_uuid7()}"


def make_scheduled_id() -> str:
    return f"sched_{make_uuid7()}"


def make_reminder_id() -> str:
    return f"rem_{make_uuid7()}"


def make_dm_channel_id(participant_ids: list[str]) -> str:
    """Stable channel id for a sorted DM participant set."""
    import hashlib

    sorted_ids = sorted(set(participant_ids))
    digest = hashlib.sha1("|".join(sorted_ids).encode("utf-8")).hexdigest()[:12]
    return f"dm_{digest}"
