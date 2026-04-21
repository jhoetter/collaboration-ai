from __future__ import annotations

from typing import Any

from domain.bridges.matrix.client import MatrixCreds, fetch_sync
from domain.bridges.matrix.importer import normalise_sync


def _canned_response() -> dict[str, Any]:
    return {
        "next_batch": "tok-2",
        "rooms": {
            "join": {
                "!room:example.org": {
                    "timeline": {
                        "events": [
                            {
                                "type": "m.room.message",
                                "event_id": "$1",
                                "sender": "@alice:example.org",
                                "origin_server_ts": 1_000,
                                "content": {"msgtype": "m.text", "body": "hello"},
                            },
                            {
                                "type": "m.room.message",
                                "event_id": "$2",
                                "sender": "@bob:example.org",
                                "origin_server_ts": 2_000,
                                "content": {
                                    "msgtype": "m.text",
                                    "body": "reply",
                                    "m.relates_to": {"m.in_reply_to": {"event_id": "$1"}},
                                },
                            },
                            {
                                "type": "m.room.message",
                                "event_id": "$3",
                                "sender": "@bob:example.org",
                                "origin_server_ts": 3_000,
                                "content": {"msgtype": "m.image", "body": "img.png"},
                            },
                        ]
                    }
                }
            }
        },
    }


def test_fetch_sync_passes_token_and_extracts_rooms() -> None:
    seen: dict[str, Any] = {}

    def http(url: str, *, params: dict[str, str], headers: dict[str, str]) -> dict[str, Any]:
        seen["url"] = url
        seen["params"] = params
        seen["headers"] = headers
        return _canned_response()

    creds = MatrixCreds(homeserver="https://matrix.example.org", access_token="tok")
    response = fetch_sync(creds, since=None, http=http)

    assert response.next_batch == "tok-2"
    assert "!room:example.org" in response.rooms
    assert seen["headers"]["Authorization"] == "Bearer tok"


def test_fetch_sync_resumes_with_since_token() -> None:
    captured: dict[str, str] = {}

    def http(url: str, *, params: dict[str, str], headers: dict[str, str]) -> dict[str, Any]:
        captured.update(params)
        return {"next_batch": "x", "rooms": {}}

    creds = MatrixCreds(homeserver="https://matrix.example.org", access_token="tok")
    fetch_sync(creds, since="prev-token", http=http)
    assert captured["since"] == "prev-token"


def test_normalise_sync_drops_non_text_messages_and_threads_replies() -> None:
    creds = MatrixCreds(homeserver="https://m", access_token="tok")
    response = fetch_sync(creds, since=None, http=lambda *a, **kw: _canned_response())
    events = list(normalise_sync(response, room_names={"!room:example.org": "general"}))

    assert {e.text for e in events} == {"hello", "reply"}
    by_id = {e.external_message_id: e for e in events}
    assert by_id["$2"].thread_root == "$1"
    assert all(e.external_channel_name == "general" for e in events)
