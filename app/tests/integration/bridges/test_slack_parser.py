from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path

import pytest

from domain.bridges.slack.parser import parse_export


def _build_export(tmp_path: Path) -> Path:
    """Create a tiny synthetic Slack export."""
    target = tmp_path / "export.zip"
    with zipfile.ZipFile(target, "w") as zf:
        zf.writestr(
            "users.json",
            json.dumps(
                [
                    {"id": "U1", "name": "alice", "profile": {"display_name": "Alice"}},
                    {"id": "U2", "name": "bob", "profile": {"display_name": "Bob"}},
                ]
            ),
        )
        zf.writestr(
            "channels.json",
            json.dumps([{"id": "C1", "name": "general"}, {"id": "C2", "name": "random"}]),
        )
        zf.writestr("groups.json", json.dumps([{"id": "G1", "name": "leads"}]))
        zf.writestr(
            "general/2024-01-01.json",
            json.dumps(
                [
                    {"type": "message", "user": "U1", "ts": "1.000", "text": "hello"},
                    {
                        "type": "message",
                        "user": "U2",
                        "ts": "2.000",
                        "text": "reply",
                        "thread_ts": "1.000",
                    },
                ]
            ),
        )
        zf.writestr(
            "random/2024-01-01.json",
            json.dumps([{"type": "message", "user": "U1", "ts": "3.000", "text": "lol"}]),
        )
        zf.writestr(
            "leads/2024-01-01.json",
            json.dumps([{"type": "message", "user": "U1", "ts": "4.000", "text": "private"}]),
        )
    return target


def test_parse_export_orders_channels_alphabetically(tmp_path: Path) -> None:
    path = _build_export(tmp_path)
    events = list(parse_export(path))
    channels_in_order = []
    for ev in events:
        if not channels_in_order or channels_in_order[-1] != ev.external_channel_name:
            channels_in_order.append(ev.external_channel_name)
    assert channels_in_order == ["general", "leads", "random"]


def test_parse_export_marks_threads_and_users(tmp_path: Path) -> None:
    path = _build_export(tmp_path)
    events = list(parse_export(path))
    by_id = {e.external_message_id: e for e in events}
    assert by_id["1.000"].thread_root is None
    assert by_id["2.000"].thread_root == "1.000"
    assert by_id["1.000"].external_user_display == "Alice"


def test_parse_export_marks_groups_as_private(tmp_path: Path) -> None:
    path = _build_export(tmp_path)
    private_events = [e for e in parse_export(path) if e.is_private]
    assert {e.external_channel_name for e in private_events} == {"leads"}


def test_parse_export_skips_non_message_types(tmp_path: Path) -> None:
    target = tmp_path / "export.zip"
    with zipfile.ZipFile(target, "w") as zf:
        zf.writestr("users.json", "[]")
        zf.writestr("channels.json", json.dumps([{"id": "C1", "name": "general"}]))
        zf.writestr(
            "general/2024-01-01.json",
            json.dumps(
                [
                    {"type": "channel_join", "user": "U1", "ts": "1.000"},
                    {"type": "message", "user": "U1", "ts": "2.000", "text": "real"},
                ]
            ),
        )
    events = list(parse_export(target))
    assert len(events) == 1
    assert events[0].text == "real"
