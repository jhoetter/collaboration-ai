"""Huddle `@function` endpoints.

The chat itself never talks to LiveKit. The frontend hits these
endpoints which:

1. Dispatch the `huddle:start` / `huddle:join` / `huddle:leave` /
   `huddle:end` command through the bus so the event log captures who
   was on the call (and the projection table can answer "is there a
   huddle running in #design?" without replaying the log).
2. Mint a short-lived LiveKit AccessToken bound to the room name from
   the projected huddle.

When `livekit-api` is not installed (e.g. in unit tests that only
exercise the command bus) `huddle:token` raises a clear error so the
caller can disable the UI button.
"""

from __future__ import annotations

import datetime as _dt
import os
import time
from typing import Any

from ..events.functions import get_projected_state
from ..shared.command_bus import Command
from ..shared.decorators import function
from ..shared.runtime import get_command_bus


_LIVEKIT_URL_ENV = "LIVEKIT_URL"
_LIVEKIT_KEY_ENV = "LIVEKIT_API_KEY"
_LIVEKIT_SECRET_ENV = "LIVEKIT_API_SECRET"

_DEFAULT_DEV_URL = "ws://localhost:7880"
_DEFAULT_DEV_KEY = "devkey"
_DEFAULT_DEV_SECRET = "dev-secret-please-change-me-32chars-min"


def _livekit_config() -> tuple[str, str, str]:
    return (
        os.getenv(_LIVEKIT_URL_ENV, _DEFAULT_DEV_URL),
        os.getenv(_LIVEKIT_KEY_ENV, _DEFAULT_DEV_KEY),
        os.getenv(_LIVEKIT_SECRET_ENV, _DEFAULT_DEV_SECRET),
    )


@function(name="huddle:start", mcp_expose=True, mcp_scope="write:huddles")
def start_huddle(
    workspace_id: str,
    channel_id: str,
    *,
    title: str | None = None,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="huddle:start",
            payload={**({"title": title} if title else {})},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="huddle:join", mcp_expose=True, mcp_scope="write:huddles")
def join_huddle(
    workspace_id: str,
    channel_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="huddle:join",
            payload={},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="huddle:leave", mcp_expose=True, mcp_scope="write:huddles")
def leave_huddle(
    workspace_id: str,
    channel_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="huddle:leave",
            payload={},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="huddle:end", mcp_expose=True, mcp_scope="write:huddles")
def end_huddle(
    workspace_id: str,
    channel_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    bus = get_command_bus()
    return bus.dispatch(
        Command(
            type="huddle:end",
            payload={},
            source="human",
            actor_id=actor_id,
            workspace_id=workspace_id,
            room_id=channel_id,
        )
    ).to_dict()


@function(name="huddle:token", mcp_expose=False)
def huddle_token(
    workspace_id: str,
    channel_id: str,
    *,
    actor_id: str,
) -> dict[str, Any]:
    """Return a short-lived LiveKit AccessToken for the active huddle.

    Starts a huddle if none is running, then mints a token bound to
    the LiveKit room name. The token TTL is 10 minutes; clients
    refresh by calling this endpoint again.
    """
    state = get_projected_state(workspace_id)
    huddle = state.huddles.get(channel_id)
    if huddle is None:
        # Lazy-start: kick off the huddle so the caller's token works
        # immediately without a separate `huddle:start` round-trip.
        # Surface the underlying rejection (e.g. unknown channel,
        # forbidden) instead of swallowing it — otherwise the client
        # only ever sees a confusing "failed to materialise" message.
        bus = get_command_bus()
        result = bus.dispatch(
            Command(
                type="huddle:start",
                payload={},
                source="human",
                actor_id=actor_id,
                workspace_id=workspace_id,
                room_id=channel_id,
            )
        )
        if result.status == "rejected" and result.error is not None:
            raise RuntimeError(
                f"huddle:start was rejected ({result.error.code}): {result.error.message}"
            )
        state = get_projected_state(workspace_id)
        huddle = state.huddles.get(channel_id)
    if huddle is None:
        raise RuntimeError("huddle:token failed to materialise a huddle")

    url, key, secret = _livekit_config()
    room = huddle["livekit_room"]
    display_name = _resolve_display_name(actor_id)
    token = _mint_access_token(
        api_key=key,
        api_secret=secret,
        room=room,
        identity=actor_id,
        display_name=display_name,
        ttl_seconds=600,
    )
    return {"url": url, "token": token, "room": room, "huddle_id": huddle["huddle_id"]}


def _resolve_display_name(user_id: str) -> str:
    """Look up the user's display name for the LiveKit participant tile.

    Best-effort — falls back to ``user_id`` if the lookup fails (e.g. when
    running unit tests with no DB).  We intentionally don't take a hard
    dependency on the auth store here.
    """
    try:
        from sqlalchemy import text

        from ..shared.runtime import open_session

        with open_session() as session:
            row = session.execute(
                text("SELECT display_name FROM users WHERE user_id = :u"),
                {"u": user_id},
            ).first()
            if row and row[0]:
                return str(row[0])
    except Exception:
        pass
    return user_id


def _mint_access_token(
    *,
    api_key: str,
    api_secret: str,
    room: str,
    identity: str,
    display_name: str | None = None,
    ttl_seconds: int,
) -> str:
    """Mint a LiveKit JWT.

    Uses ``livekit-api`` if installed; otherwise falls back to a
    hand-rolled HMAC-SHA256 JWT (the wire format LiveKit accepts).
    The fallback exists so the UI can be exercised with just `pyjwt`-
    free environments and so unit tests don't pull a heavy SDK.
    """
    try:
        from livekit import api as livekit_api  # type: ignore[import-not-found]

        token = livekit_api.AccessToken(api_key, api_secret).with_identity(identity)
        if display_name and display_name != identity:
            token = token.with_name(display_name)
        token = token.with_grants(
            livekit_api.VideoGrants(
                room_join=True,
                room=room,
                can_publish=True,
                can_subscribe=True,
                can_publish_data=True,
            )
        )
        # `livekit-api` >= 0.7 takes a `datetime.timedelta` here, not an
        # int — passing seconds raises "unsupported operand type(s) for
        # +: 'datetime.datetime' and 'int'" deep inside the SDK.
        token = token.with_ttl(_dt.timedelta(seconds=ttl_seconds))
        return token.to_jwt()
    except ImportError:
        return _fallback_jwt(api_key, api_secret, room, identity, ttl_seconds, display_name)


def _fallback_jwt(
    api_key: str,
    api_secret: str,
    room: str,
    identity: str,
    ttl_seconds: int,
    display_name: str | None = None,
) -> str:
    import base64
    import hashlib
    import hmac
    import json

    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "iss": api_key,
        "sub": identity,
        "iat": now,
        "exp": now + ttl_seconds,
        "nbf": now - 5,
        "name": display_name or identity,
        "video": {
            "roomJoin": True,
            "room": room,
            "canPublish": True,
            "canSubscribe": True,
            "canPublishData": True,
        },
    }

    def b64(obj: dict[str, Any] | bytes) -> str:
        raw = obj if isinstance(obj, bytes) else json.dumps(obj, separators=(",", ":")).encode()
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

    signing_input = f"{b64(header)}.{b64(payload)}".encode()
    sig = hmac.new(api_secret.encode(), signing_input, hashlib.sha256).digest()
    return f"{signing_input.decode()}.{b64(sig)}"
