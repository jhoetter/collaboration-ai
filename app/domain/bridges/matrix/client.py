from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol


class HTTPGetter(Protocol):
    def __call__(
        self, url: str, *, params: dict[str, str], headers: dict[str, str]
    ) -> dict[str, Any]: ...


@dataclass(frozen=True)
class MatrixCreds:
    homeserver: str  # e.g. "https://matrix.example.org"
    access_token: str


@dataclass(frozen=True)
class SyncResponse:
    next_batch: str
    rooms: dict[str, list[dict[str, Any]]]
    """room_id -> list of timeline events as returned by the server."""


def fetch_sync(
    creds: MatrixCreds,
    *,
    since: str | None,
    timeout_ms: int = 10_000,
    http: HTTPGetter,
) -> SyncResponse:
    """Call `/sync` once and normalise to a small shape.

    `http` is injected so tests can replay canned responses; the
    runtime caller wires it to `httpx.get(...).json()` or similar.
    No SDK dependency on purpose — Matrix client libraries are
    heavy and we only need a sliver of `/sync`.
    """
    url = f"{creds.homeserver.rstrip('/')}/_matrix/client/v3/sync"
    params: dict[str, str] = {"timeout": str(timeout_ms)}
    if since:
        params["since"] = since
    headers = {"Authorization": f"Bearer {creds.access_token}"}

    body = http(url, params=params, headers=headers)
    next_batch = str(body.get("next_batch", ""))
    rooms_block = (body.get("rooms") or {}).get("join") or {}

    rooms: dict[str, list[dict[str, Any]]] = {}
    for room_id, room_block in rooms_block.items():
        timeline = (room_block.get("timeline") or {}).get("events") or []
        rooms[room_id] = list(timeline)

    return SyncResponse(next_batch=next_batch, rooms=rooms)
