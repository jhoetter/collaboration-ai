"""Thread queries derived from `ProjectedState`."""

from __future__ import annotations

from ..events.projector import ProjectedState


def list_replies(state: ProjectedState, thread_root_id: str) -> list[dict]:
    """All non-redacted replies to ``thread_root_id`` in (sequence) order."""
    return sorted(
        (
            msg
            for msg in state.messages.values()
            if msg.get("thread_root") == thread_root_id and not msg.get("redacted")
        ),
        key=lambda m: int(m.get("sequence") or 0),
    )


def list_threads_in_channel(state: ProjectedState, channel_id: str) -> list[dict]:
    """All thread-root messages in a channel that have ≥1 non-redacted reply."""
    return [
        msg
        for msg in state.messages.values()
        if msg["channel_id"] == channel_id
        and msg.get("thread_reply_count")
        and not msg.get("redacted")
    ]
