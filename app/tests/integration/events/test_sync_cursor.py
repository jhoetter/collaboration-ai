"""Sync cursor encoding round-trips."""

from __future__ import annotations

from domain.shared.sync_cursor import SyncCursor, advance, decode_cursor, encode_cursor


def test_round_trip_simple() -> None:
    encoded = encode_cursor("ws_demo", 12345)
    decoded = decode_cursor(encoded, workspace_id="ws_demo")
    assert decoded.workspace_id == "ws_demo"
    assert decoded.sequence == 12345


def test_garbage_input_falls_back_to_zero() -> None:
    decoded = decode_cursor("not-base64-at-all!!!", workspace_id="ws_demo")
    assert decoded.sequence == 0


def test_missing_cursor_returns_zero() -> None:
    decoded = decode_cursor(None, workspace_id="ws_demo")
    assert decoded.sequence == 0
    assert decoded.workspace_id == "ws_demo"


def test_advance_only_moves_forward() -> None:
    c = SyncCursor(workspace_id="ws_demo", sequence=10)
    assert advance(c, 5).sequence == 10
    assert advance(c, 11).sequence == 11
    assert advance(c, 1_000_000).sequence == 1_000_000


def test_cursor_does_not_leak_workspace_when_decoded_with_different_ws() -> None:
    """The encoded cursor pins the workspace; we should still decode it."""
    encoded = encode_cursor("ws_a", 7)
    decoded = decode_cursor(encoded, workspace_id="ws_b")
    # The encoded value wins so a copy-pasted cursor doesn't accidentally
    # let a client read another workspace's events; the auth layer must
    # additionally verify the cursor's workspace matches the session.
    assert decoded.workspace_id == "ws_a"
    assert decoded.sequence == 7
