from __future__ import annotations

import json
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Iterator

from ..protocol import BridgeEvent


@dataclass(frozen=True)
class SlackUser:
    id: str
    display: str


def _load_users(root: zipfile.ZipFile) -> dict[str, SlackUser]:
    try:
        raw = json.loads(root.read("users.json"))
    except KeyError:
        return {}
    out: dict[str, SlackUser] = {}
    for u in raw:
        uid = u.get("id")
        if not uid:
            continue
        profile = u.get("profile") or {}
        display = (
            profile.get("display_name")
            or profile.get("real_name")
            or u.get("name")
            or uid
        )
        out[uid] = SlackUser(id=uid, display=display)
    return out


def _load_channels(
    root: zipfile.ZipFile, *, private: bool
) -> list[dict[str, object]]:
    name = "groups.json" if private else "channels.json"
    try:
        return json.loads(root.read(name))
    except KeyError:
        return []


def parse_export(path: Path) -> Iterator[BridgeEvent]:
    """Yield `BridgeEvent`s from a Slack workspace export `.zip`.

    Order is by (channel name, message ts) so callers can rely on a
    deterministic sequence regardless of zip ordering.
    """
    with zipfile.ZipFile(path) as zf:
        users = _load_users(zf)

        channels = [
            (ch, False) for ch in _load_channels(zf, private=False)
        ] + [
            (ch, True) for ch in _load_channels(zf, private=True)
        ]
        channels.sort(key=lambda pair: pair[0].get("name", ""))

        for ch, is_private in channels:
            ch_id = ch.get("id")
            ch_name = ch.get("name")
            if not ch_id or not ch_name:
                continue
            files = sorted(
                n for n in zf.namelist()
                if n.startswith(f"{ch_name}/") and n.endswith(".json")
            )
            for f in files:
                day_messages = json.loads(zf.read(f))
                day_messages.sort(key=lambda m: float(m.get("ts", 0)))
                for msg in day_messages:
                    if msg.get("type") != "message":
                        continue
                    user_id = msg.get("user") or msg.get("bot_id") or "unknown"
                    user = users.get(user_id, SlackUser(id=user_id, display=user_id))
                    text = msg.get("text") or ""
                    ts = float(msg.get("ts", 0))
                    thread_ts = msg.get("thread_ts")
                    thread_root = (
                        str(thread_ts)
                        if thread_ts and str(thread_ts) != str(msg.get("ts"))
                        else None
                    )
                    edited = (msg.get("edited") or {}).get("ts")
                    yield BridgeEvent(
                        provider="slack",
                        external_channel_id=str(ch_id),
                        external_channel_name=str(ch_name),
                        external_message_id=str(msg.get("ts")),
                        external_user_id=user.id,
                        external_user_display=user.display,
                        external_ts=ts,
                        text=text,
                        thread_root=thread_root,
                        is_edit_of=str(edited) if edited else None,
                        is_private=is_private,
                    )
