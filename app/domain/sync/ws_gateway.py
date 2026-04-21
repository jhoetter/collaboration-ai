"""FastAPI WebSocket gateway + `/api/sync` long-poll route.

Imports FastAPI lazily so the unit tests for `Fanout`, `BoundedQueue`,
`PresenceTracker` don't pull it in.

Wire format: every frame is a JSON-encoded ``SyncMessage.to_dict()``.
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from ..events.repository import stream_events
from ..shared.sync_cursor import advance, decode_cursor, encode_cursor
from .fanout import InProcessFanout
from .messages import ControlFrame, SyncMessage
from .queue import BoundedQueue

logger = logging.getLogger(__name__)


SYNC_LONG_POLL_TIMEOUT_S = 25


def build_router(*, fanout: InProcessFanout, session_factory):  # type: ignore[no-untyped-def]
    """Create the FastAPI router. The session_factory is used by the
    long-poll path to stream missed events from Postgres."""
    from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

    router = APIRouter()

    @router.get("/api/sync")
    async def sync(
        workspace_id: str,
        since: str | None = Query(default=None),
        max_events: int = Query(default=500, le=2_000),
    ) -> dict[str, Any]:
        cursor = decode_cursor(since, workspace_id=workspace_id)
        # Cheap path: any events past the cursor in Postgres → return now.
        with session_factory() as session:
            events = list(
                stream_events(
                    session,
                    workspace_id=workspace_id,
                    since_sequence=cursor.sequence,
                    limit=max_events,
                )
            )
        if events:
            new_cursor = advance(cursor, max(e.sequence for e in events))
            return SyncMessage(
                type="event",
                workspace_id=workspace_id,
                cursor=new_cursor.encode(),
                events=events,
            ).to_dict()

        # Slow path: subscribe to the workspace's fanout and wait.
        queue: BoundedQueue = BoundedQueue(maxsize=64)
        sub_id = fanout.subscribe(workspace_id, set(), queue)
        try:
            await asyncio.wait_for(_wait_for_event(queue), timeout=SYNC_LONG_POLL_TIMEOUT_S)
        except asyncio.TimeoutError:
            return SyncMessage(
                type="control",
                workspace_id=workspace_id,
                cursor=cursor.encode(),
                control=ControlFrame(kind="ping"),
            ).to_dict()
        finally:
            fanout.unsubscribe(sub_id)

        events = [item for item in queue.drain() if item is not None]
        if not events:
            raise HTTPException(status_code=503, detail="empty wakeup")
        new_cursor = advance(cursor, max(getattr(e, "sequence", cursor.sequence) for e in events))
        return SyncMessage(
            type="event",
            workspace_id=workspace_id,
            cursor=new_cursor.encode(),
            events=events,
        ).to_dict()

    @router.websocket("/ws/events")
    async def ws_events(websocket: WebSocket, workspace_id: str = "") -> None:
        await websocket.accept()
        if not workspace_id:
            await websocket.close(code=4400, reason="workspace_id required")
            return

        queue: BoundedQueue = BoundedQueue(maxsize=256)

        def _on_overflow(sub_id: int) -> None:
            asyncio.get_event_loop().create_task(
                _send(
                    websocket,
                    SyncMessage(
                        type="control",
                        workspace_id=workspace_id,
                        cursor=encode_cursor(workspace_id, 0),
                        control=ControlFrame(
                            kind="force-resync",
                            detail={"reason": "queue overflow"},
                        ),
                    ),
                )
            )

        sub_id = fanout.subscribe(workspace_id, set(), queue, on_overflow=_on_overflow)  # type: ignore[arg-type]
        try:
            push_task = asyncio.create_task(_push_loop(websocket, queue, workspace_id))
            recv_task = asyncio.create_task(_recv_loop(websocket))
            done, pending = await asyncio.wait(
                {push_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
        except WebSocketDisconnect:
            pass
        finally:
            fanout.unsubscribe(sub_id)

    return router


async def _wait_for_event(queue: BoundedQueue) -> None:
    while len(queue) == 0:
        await asyncio.sleep(0.05)


async def _push_loop(websocket, queue: BoundedQueue, workspace_id: str) -> None:  # type: ignore[no-untyped-def]
    while True:
        if len(queue) == 0:
            await asyncio.sleep(0.05)
            continue
        events = [item for item in queue.drain() if item is not None]
        if not events:
            continue
        max_seq = max(getattr(e, "sequence", 0) for e in events)
        msg = SyncMessage(
            type="event",
            workspace_id=workspace_id,
            cursor=encode_cursor(workspace_id, max_seq),
            events=events,
        )
        await _send(websocket, msg)


async def _recv_loop(websocket) -> None:  # type: ignore[no-untyped-def]
    while True:
        text = await websocket.receive_text()
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue
        if payload.get("type") == "ping":
            await websocket.send_text(json.dumps({"type": "control", "control": {"kind": "pong"}}))


async def _send(websocket, message: SyncMessage) -> None:  # type: ignore[no-untyped-def]
    await websocket.send_text(json.dumps(message.to_dict(), default=str))
