"""Redis pub/sub fanout for multi-process / multi-pod deployments.

Publishes each committed event as JSON to ``collabai:events:{workspace_id}``
and bridges incoming Redis messages back into the local
:class:`InProcessFanout`, so subscribers don't need to know which pod
ingested the command.

Usage::

    bridge = RedisFanout(redis_client, local=InProcessFanout())
    await bridge.start(["ws_a", "ws_b"])
    bridge.publish(event)         # also goes to Redis
    bridge.local.subscribe(...)   # local consumers
"""

from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass, field
from typing import Any

from ..events.model import Event
from .fanout import InProcessFanout

CHANNEL_PREFIX = "collabai:events:"


def channel_for(workspace_id: str) -> str:
    return f"{CHANNEL_PREFIX}{workspace_id}"


def _event_to_json(event: Event) -> str:
    return json.dumps(event.to_dict(), sort_keys=True)


def _event_from_json(payload: str) -> Event:
    return Event.from_dict(json.loads(payload))


@dataclass
class RedisFanout:
    """Bridge between Redis pub/sub and an in-process fanout."""

    redis: Any  # redis.asyncio.Redis
    local: InProcessFanout = field(default_factory=InProcessFanout)
    _task: asyncio.Task[None] | None = None
    _pubsub: Any = None

    async def start(self, workspace_ids: list[str]) -> None:
        self._pubsub = self.redis.pubsub()
        await self._pubsub.subscribe(*[channel_for(w) for w in workspace_ids])
        self._task = asyncio.create_task(self._reader_loop(), name="collabai-redis-fanout")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except (asyncio.CancelledError, BaseException):
                pass
            self._task = None
        if self._pubsub is not None:
            await self._pubsub.close()
            self._pubsub = None

    async def _reader_loop(self) -> None:
        assert self._pubsub is not None
        async for msg in self._pubsub.listen():  # pragma: no cover - exercised in integration env
            if msg.get("type") != "message":
                continue
            data = msg.get("data")
            if isinstance(data, (bytes, bytearray)):
                data = data.decode("utf-8")
            self.local.publish(_event_from_json(data))

    async def publish(self, event: Event) -> None:
        await self.redis.publish(channel_for(event.workspace_id), _event_to_json(event))

    def subscribe(self, *args: Any, **kwargs: Any) -> int:
        return self.local.subscribe(*args, **kwargs)

    def unsubscribe(self, subscription_id: int) -> None:
        self.local.unsubscribe(subscription_id)
