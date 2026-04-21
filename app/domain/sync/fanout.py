"""Fan-out abstractions: in-process (tests) and Redis pub/sub (prod)."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from typing import Callable, Protocol

from ..events.model import Event
from .queue import BoundedQueue


class Fanout(Protocol):
    """Distribute committed events to subscribers.

    Subscribers register a `BoundedQueue` keyed by `(workspace_id,
    room_set)`. The fanout walks subscribers and pushes each event to
    queues whose room_set intersects the event's room.
    """

    def subscribe(self, workspace_id: str, room_ids: set[str], queue: BoundedQueue) -> int: ...
    def unsubscribe(self, subscription_id: int) -> None: ...
    def publish(self, event: Event) -> int: ...
    """Returns the number of subscribers who received the event."""


@dataclass(slots=True)
class _Subscription:
    workspace_id: str
    room_ids: set[str]
    queue: BoundedQueue
    on_overflow: Callable[[int], None] | None = None


@dataclass(slots=True)
class InProcessFanout:
    """Test fanout. The live one (`RedisFanout`) is a thin wrapper that
    PUBLISHes the same JSON to a per-workspace Redis channel and lets a
    background task feed local subscribers."""

    _next_id: int = 0
    _subs: dict[int, _Subscription] = field(default_factory=dict)
    _by_workspace: dict[str, set[int]] = field(default_factory=lambda: defaultdict(set))
    overflowed_subscription_ids: set[int] = field(default_factory=set)

    def subscribe(
        self,
        workspace_id: str,
        room_ids: set[str],
        queue: BoundedQueue,
        *,
        on_overflow: Callable[[int], None] | None = None,
    ) -> int:
        self._next_id += 1
        sub_id = self._next_id
        self._subs[sub_id] = _Subscription(workspace_id, set(room_ids), queue, on_overflow)
        self._by_workspace[workspace_id].add(sub_id)
        return sub_id

    def unsubscribe(self, subscription_id: int) -> None:
        sub = self._subs.pop(subscription_id, None)
        if sub is not None:
            self._by_workspace[sub.workspace_id].discard(subscription_id)

    def publish(self, event: Event) -> int:
        delivered = 0
        for sub_id in list(self._by_workspace.get(event.workspace_id, ())):
            sub = self._subs.get(sub_id)
            if sub is None:
                continue
            # Empty room_ids = "all rooms in workspace" subscription.
            if sub.room_ids and event.room_id not in sub.room_ids:
                continue
            if sub.queue.put(event):
                delivered += 1
            else:
                self.overflowed_subscription_ids.add(sub_id)
                if sub.on_overflow is not None:
                    sub.on_overflow(sub_id)
        return delivered

    def reset(self) -> None:
        self._subs.clear()
        self._by_workspace.clear()
        self.overflowed_subscription_ids.clear()
        self._next_id = 0
