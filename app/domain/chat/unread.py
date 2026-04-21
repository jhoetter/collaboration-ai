"""Per-channel unread + mention counts derived from `ProjectedState`."""

from __future__ import annotations

from dataclasses import dataclass

from ..events.projector import ProjectedState


@dataclass(slots=True, frozen=True)
class ChannelUnread:
    channel_id: str
    unread: int
    mention_count: int
    last_sequence: int


def channel_last_sequence(state: ProjectedState, channel_id: str) -> int:
    last = 0
    for msg in state.messages.values():
        if msg["channel_id"] == channel_id and not msg.get("redacted"):
            seq = int(msg.get("sequence") or 0)
            if seq > last:
                last = seq
    return last


def unread_for_user(
    state: ProjectedState,
    *,
    user_id: str,
    workspace_id: str,
) -> list[ChannelUnread]:
    """One row per channel the user can currently see."""
    user_markers = state.read_markers.get(user_id, {})
    visible_channels = [
        ch for ch in state.channels.values()
        if ch["workspace_id"] == workspace_id
        and (
            user_id in state.channel_members.get(ch["id"], {})
            or not ch.get("private")
        )
    ]
    out: list[ChannelUnread] = []
    for ch in visible_channels:
        ch_id = ch["id"]
        last_seq = channel_last_sequence(state, ch_id)
        marker = int(user_markers.get(ch_id, 0))
        unread = 0
        mentions = 0
        for msg in state.messages.values():
            if msg["channel_id"] != ch_id:
                continue
            if msg.get("redacted"):
                continue
            seq = int(msg.get("sequence") or 0)
            if seq <= marker:
                continue
            unread += 1
            if user_id in (msg.get("mentions") or []):
                mentions += 1
        out.append(
            ChannelUnread(
                channel_id=ch_id,
                unread=unread,
                mention_count=mentions,
                last_sequence=last_seq,
            )
        )
    return out
