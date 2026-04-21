from __future__ import annotations

from typing import Iterable

from ..protocol import BridgeEvent
from .client import SyncResponse


def normalise_sync(
    response: SyncResponse, *, room_names: dict[str, str]
) -> Iterable[BridgeEvent]:
    """Translate a Matrix `/sync` response into `BridgeEvent`s.

    Only `m.room.message` events with `msgtype="m.text"` are emitted
    today; richer message types are intentionally dropped to keep the
    archive readable. Replies (`m.relates_to`) become threads.
    """
    for room_id, events in response.rooms.items():
        room_name = room_names.get(room_id, room_id)
        for event in events:
            if event.get("type") != "m.room.message":
                continue
            content = event.get("content") or {}
            if content.get("msgtype") != "m.text":
                continue

            relates = content.get("m.relates_to") or {}
            in_reply_to = (relates.get("m.in_reply_to") or {}).get("event_id")

            yield BridgeEvent(
                provider="matrix",
                external_channel_id=room_id,
                external_channel_name=room_name,
                external_message_id=str(event.get("event_id", "")),
                external_user_id=str(event.get("sender", "unknown")),
                external_user_display=str(event.get("sender", "unknown")),
                external_ts=float(event.get("origin_server_ts", 0)) / 1000.0,
                text=str(content.get("body", "")),
                thread_root=in_reply_to,
                is_edit_of=None,
                is_private=False,
            )
