from __future__ import annotations

import hashlib
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

from ..protocol import BridgeEvent, archive_channel_name, bridge_agent_id
from .parser import parse_export

CommandFn = Callable[[str, dict], None]
"""(`command_type`, `payload`) -> None. The importer never touches DB
state directly; it only produces commands. Real callers wire this to
the command bus."""


@dataclass
class ImportResult:
    channels_created: int = 0
    messages_imported: int = 0
    messages_skipped: int = 0
    errors: list[str] = field(default_factory=list)


@dataclass
class ImportState:
    """Persisted between runs so re-imports are no-ops."""

    imported_message_ids: set[str] = field(default_factory=set)
    created_channels: set[str] = field(default_factory=set)


def export_hash(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(64 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def import_events(
    workspace_id: str,
    events: Iterable[BridgeEvent],
    *,
    state: ImportState,
    dispatch: CommandFn,
) -> ImportResult:
    """Translate `BridgeEvent`s into `chat:send-message` commands.

    The caller supplies `dispatch` so this function is fully
    deterministic and easy to test without a running command bus.
    """
    result = ImportResult()
    agent = bridge_agent_id("slack")

    for ev in events:
        local_channel = archive_channel_name(ev.provider, ev.external_channel_name)
        channel_key = f"{workspace_id}::{local_channel}"

        if channel_key not in state.created_channels:
            dispatch(
                "channel:create",
                {
                    "workspace_id": workspace_id,
                    "name": local_channel,
                    "type": "private" if ev.is_private else "public",
                    "archive": True,
                    "metadata": {
                        "bridge": ev.provider,
                        "external_channel_id": ev.external_channel_id,
                    },
                },
            )
            state.created_channels.add(channel_key)
            result.channels_created += 1

        msg_key = f"{ev.provider}::{ev.external_channel_id}::{ev.external_message_id}"
        if msg_key in state.imported_message_ids:
            result.messages_skipped += 1
            continue

        try:
            dispatch(
                "chat:send-message",
                {
                    "workspace_id": workspace_id,
                    "channel_name": local_channel,
                    "content": ev.text,
                    "sender_id": agent,
                    "sender_type": "system",
                    "metadata": {
                        "bridge": ev.provider,
                        "external_message_id": ev.external_message_id,
                        "external_user_id": ev.external_user_id,
                        "external_user_display": ev.external_user_display,
                        "external_ts": ev.external_ts,
                        "thread_root": ev.thread_root,
                        "is_edit_of": ev.is_edit_of,
                    },
                },
            )
            state.imported_message_ids.add(msg_key)
            result.messages_imported += 1
        except Exception as exc:  # noqa: BLE001 — record per-message failures
            result.errors.append(f"{msg_key}: {exc}")

    return result


def import_export(
    workspace_id: str,
    export_path: Path,
    *,
    state: ImportState,
    dispatch: CommandFn,
) -> ImportResult:
    """Convenience wrapper for the common case (zip on disk)."""
    return import_events(
        workspace_id,
        parse_export(export_path),
        state=state,
        dispatch=dispatch,
    )
