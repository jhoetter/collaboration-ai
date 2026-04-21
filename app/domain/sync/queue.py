"""Bounded per-connection queue with overflow detection.

Pure logic; the live FastAPI WS gateway uses ``asyncio.Queue`` with the
same semantics, but unit tests use this synchronous variant to assert
overflow behaviour exactly.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass


class QueueOverflow(Exception):
    """Raised when ``put`` is called on a full ``BoundedQueue`` whose
    overflow policy is ``raise``."""


@dataclass(slots=True)
class BoundedQueue:
    """Drop-on-overflow queue with a "force-resync" hint.

    The runtime calls ``put(item)``; if the queue is full, the call
    returns ``False`` (no exception) so the caller can emit a
    `force-resync` control frame to the client. The queue stays
    drained for inspection.
    """

    maxsize: int = 256
    _items: deque = None  # type: ignore[assignment]
    overflowed: bool = False

    def __post_init__(self) -> None:
        if self._items is None:
            self._items = deque(maxlen=self.maxsize)

    def __len__(self) -> int:
        return len(self._items)

    def put(self, item: object) -> bool:
        """Return True on success, False on overflow."""
        if len(self._items) >= self.maxsize:
            self.overflowed = True
            return False
        self._items.append(item)
        return True

    def get(self) -> object:
        return self._items.popleft()

    def drain(self) -> list[object]:
        out = list(self._items)
        self._items.clear()
        return out
