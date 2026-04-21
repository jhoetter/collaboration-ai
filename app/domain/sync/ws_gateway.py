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

# `from __future__ import annotations` turns every type hint into a string
# evaluated lazily via `typing.get_type_hints`. FastAPI resolves the annotations
# of a websocket endpoint at registration time to decide which parameters are
# WebSockets vs. query params; if `WebSocket` is only imported lazily inside
# `build_router`, the resolver can't find it in module globals and silently
# treats the `websocket` parameter as a *query* param. The handshake then
# 403s because no real `websocket` query string is supplied. Importing
# `WebSocket` at module scope keeps it in globals so the resolver sees it.
from fastapi import WebSocket, WebSocketDisconnect

import time

from ..events.repository import stream_events
from ..shared.sync_cursor import advance, decode_cursor, encode_cursor
from .fanout import InProcessFanout
from .messages import ControlFrame, PresenceUpdate, SyncMessage, TypingUpdate
from .queue import BoundedQueue
from .registry import connection_registry, get_presence_tracker

logger = logging.getLogger(__name__)


SYNC_LONG_POLL_TIMEOUT_S = 25


def build_router(*, fanout: InProcessFanout, session_factory):  # type: ignore[no-untyped-def]
    """Create the FastAPI router. The session_factory is used by the
    long-poll path to stream missed events from Postgres."""
    from fastapi import APIRouter, HTTPException, Query

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
    async def ws_events(websocket: WebSocket) -> None:
        # Reading the param manually (rather than via `Query(...)`) keeps
        # the dependency tree empty; otherwise a parsing failure would
        # close the handshake before the client gets a real close code.
        workspace_id = websocket.query_params.get("workspace_id", "")
        user_id = websocket.query_params.get("user_id", "")
        await websocket.accept()
        if not workspace_id:
            await websocket.close(code=4400, reason="workspace_id required")
            return

        queue: BoundedQueue = BoundedQueue(maxsize=256)
        presence = get_presence_tracker()
        registry = connection_registry()

        async def send_async(message: SyncMessage) -> None:
            await _send(websocket, message)

        registry.add(workspace_id, send_async)

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
        if user_id:
            presence.heartbeat(workspace_id, user_id, status="active")
            await _broadcast_presence(workspace_id, user_id, "active")
            await _send_initial_presence(websocket, workspace_id)
        try:
            push_task = asyncio.create_task(_push_loop(websocket, queue, workspace_id))
            recv_task = asyncio.create_task(
                _recv_loop(websocket, workspace_id=workspace_id, user_id=user_id)
            )
            done, pending = await asyncio.wait(
                {push_task, recv_task}, return_when=asyncio.FIRST_COMPLETED
            )
            for t in pending:
                t.cancel()
        except WebSocketDisconnect:
            pass
        finally:
            fanout.unsubscribe(sub_id)
            registry.remove(workspace_id, send_async)
            if user_id:
                await _broadcast_presence(workspace_id, user_id, "offline")

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


async def _recv_loop(  # type: ignore[no-untyped-def]
    websocket, *, workspace_id: str, user_id: str
) -> None:
    presence = get_presence_tracker()
    while True:
        text = await websocket.receive_text()
        try:
            payload = json.loads(text)
        except json.JSONDecodeError:
            continue
        kind = payload.get("type")
        if kind == "ping":
            if user_id:
                presence.heartbeat(workspace_id, user_id, status="active")
            await websocket.send_text(
                json.dumps({"type": "control", "control": {"kind": "pong"}})
            )
        elif kind == "typing" and user_id:
            channel_id = payload.get("channel_id") or ""
            if not channel_id:
                continue
            presence.typing_start(channel_id, user_id)
            expires_at = int(time.time() * 1000) + presence.typing_ttl_s * 1000
            await _broadcast_typing(workspace_id, channel_id, user_id, expires_at)
        elif kind == "presence" and user_id:
            status = payload.get("status", "active")
            presence.heartbeat(workspace_id, user_id, status=status)
            await _broadcast_presence(workspace_id, user_id, status)


async def _send(websocket, message: SyncMessage) -> None:  # type: ignore[no-untyped-def]
    await websocket.send_text(json.dumps(message.to_dict(), default=str))


async def _broadcast_presence(workspace_id: str, user_id: str, status: str) -> None:
    msg = SyncMessage(
        type="presence",
        workspace_id=workspace_id,
        cursor=encode_cursor(workspace_id, 0),
        presence=[PresenceUpdate(user_id=user_id, status=status, set_at_ms=int(time.time() * 1000))],  # type: ignore[arg-type]
    )
    for send in connection_registry().fanout(workspace_id):
        try:
            await send(msg)  # type: ignore[misc]
        except Exception:  # noqa: BLE001 — best-effort broadcast
            continue


async def _broadcast_typing(
    workspace_id: str, channel_id: str, user_id: str, expires_at_ms: int
) -> None:
    msg = SyncMessage(
        type="typing",
        workspace_id=workspace_id,
        cursor=encode_cursor(workspace_id, 0),
        typing=[TypingUpdate(channel_id=channel_id, user_id=user_id, expires_at_ms=expires_at_ms)],
    )
    for send in connection_registry().fanout(workspace_id):
        try:
            await send(msg)  # type: ignore[misc]
        except Exception:  # noqa: BLE001
            continue


async def _send_initial_presence(websocket, workspace_id: str) -> None:  # type: ignore[no-untyped-def]
    presence = get_presence_tracker()
    snapshot = presence.workspace_presence(workspace_id)
    if not snapshot:
        return
    now = int(time.time() * 1000)
    msg = SyncMessage(
        type="presence",
        workspace_id=workspace_id,
        cursor=encode_cursor(workspace_id, 0),
        presence=[
            PresenceUpdate(user_id=uid, status=status, set_at_ms=now)  # type: ignore[arg-type]
            for uid, status in snapshot.items()
        ],
    )
    await _send(websocket, msg)
