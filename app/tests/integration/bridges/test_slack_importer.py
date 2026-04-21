from __future__ import annotations

from domain.bridges.protocol import BridgeEvent
from domain.bridges.slack.importer import ImportState, import_events


def _events() -> list[BridgeEvent]:
    return [
        BridgeEvent(
            provider="slack",
            external_channel_id="C1",
            external_channel_name="general",
            external_message_id="1.000",
            external_user_id="U1",
            external_user_display="Alice",
            external_ts=1.0,
            text="hello",
        ),
        BridgeEvent(
            provider="slack",
            external_channel_id="C1",
            external_channel_name="general",
            external_message_id="2.000",
            external_user_id="U2",
            external_user_display="Bob",
            external_ts=2.0,
            text="hi",
        ),
    ]


def test_import_creates_archive_channel_once() -> None:
    calls: list[tuple[str, dict]] = []
    state = ImportState()
    result = import_events("ws1", _events(), state=state, dispatch=lambda c, p: calls.append((c, p)))

    assert result.channels_created == 1
    assert result.messages_imported == 2
    create_calls = [c for c in calls if c[0] == "channel:create"]
    assert len(create_calls) == 1
    assert create_calls[0][1]["name"] == "slack-archive/general"


def test_import_is_idempotent_with_shared_state() -> None:
    calls: list[tuple[str, dict]] = []
    state = ImportState()
    import_events("ws1", _events(), state=state, dispatch=lambda c, p: calls.append((c, p)))
    second = import_events("ws1", _events(), state=state, dispatch=lambda c, p: calls.append((c, p)))

    assert second.messages_imported == 0
    assert second.messages_skipped == 2
    assert second.channels_created == 0


def test_import_attributes_messages_to_bridge_agent() -> None:
    calls: list[tuple[str, dict]] = []
    state = ImportState()
    import_events("ws1", _events(), state=state, dispatch=lambda c, p: calls.append((c, p)))
    msg_calls = [c for c in calls if c[0] == "chat:send-message"]
    assert all(c[1]["sender_id"] == "bridge:slack" for c in msg_calls)
    assert all(c[1]["sender_type"] == "system" for c in msg_calls)
    assert all(c[1]["metadata"]["bridge"] == "slack" for c in msg_calls)
