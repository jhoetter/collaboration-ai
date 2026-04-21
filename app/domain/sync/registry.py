"""Process-wide singletons for presence + typing tracking.

Mirrors :mod:`domain.sync.bridge` (which holds the fanout): tests can
swap a tracker via :func:`set_presence_tracker`, the WS gateway resolves
its current tracker via :func:`get_presence_tracker`. Lazy default uses
an in-memory TTL store keyed by wall-clock millis so single-process dev
works without Redis.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional

from .presence import InMemoryTTLStore, PresenceTracker


def _now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class _Registry:
    presence: Optional[PresenceTracker] = None


_REG = _Registry()


def set_presence_tracker(tracker: Optional[PresenceTracker]) -> None:
    _REG.presence = tracker


def get_presence_tracker() -> PresenceTracker:
    """Return the registered tracker, lazily creating an in-memory one.

    Production wiring (``functions/register.py``) sets a Redis-backed
    tracker before serving traffic so multi-pod deployments share state.
    """
    if _REG.presence is None:
        _REG.presence = PresenceTracker(store=InMemoryTTLStore(clock_ms=_now_ms))
    return _REG.presence


# ---------------------------------------------------------------------------
# Per-workspace WS connection registry
# ---------------------------------------------------------------------------


@dataclass
class _Connections:
    """Tracks live WS subscribers per workspace so we can broadcast
    presence and typing frames without going through the event log."""

    by_workspace: dict[str, set[object]] = field(default_factory=dict)

    def add(self, workspace_id: str, send) -> None:  # type: ignore[no-untyped-def]
        self.by_workspace.setdefault(workspace_id, set()).add(send)

    def remove(self, workspace_id: str, send) -> None:  # type: ignore[no-untyped-def]
        bucket = self.by_workspace.get(workspace_id)
        if bucket is None:
            return
        bucket.discard(send)
        if not bucket:
            self.by_workspace.pop(workspace_id, None)

    def fanout(self, workspace_id: str) -> list[object]:
        return list(self.by_workspace.get(workspace_id, ()))


_CONNECTIONS = _Connections()


def connection_registry() -> _Connections:
    return _CONNECTIONS
