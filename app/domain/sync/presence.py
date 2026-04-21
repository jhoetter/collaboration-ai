"""Presence + typing — pure logic over a TTL key-value store interface."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


class TTLStore(Protocol):
    """Minimal interface — Redis ``SETEX`` + ``GET`` + ``KEYS``."""

    def set_with_ttl(self, key: str, value: str, *, ttl_seconds: int) -> None: ...
    def get(self, key: str) -> str | None: ...
    def keys(self, prefix: str) -> list[str]: ...


@dataclass(slots=True)
class PresenceTracker:
    store: TTLStore
    presence_ttl_s: int = 60
    typing_ttl_s: int = 4

    # ---- presence -------------------------------------------------------

    def heartbeat(self, workspace_id: str, user_id: str, *, status: str = "active") -> None:
        self.store.set_with_ttl(
            f"presence:{workspace_id}:{user_id}",
            status,
            ttl_seconds=self.presence_ttl_s,
        )

    def status(self, workspace_id: str, user_id: str) -> str:
        return self.store.get(f"presence:{workspace_id}:{user_id}") or "offline"

    def workspace_presence(self, workspace_id: str) -> dict[str, str]:
        out: dict[str, str] = {}
        prefix = f"presence:{workspace_id}:"
        for key in self.store.keys(prefix):
            user_id = key[len(prefix):]
            value = self.store.get(key)
            if value is not None:
                out[user_id] = value
        return out

    # ---- typing ---------------------------------------------------------

    def typing_start(self, channel_id: str, user_id: str) -> None:
        self.store.set_with_ttl(
            f"typing:{channel_id}:{user_id}",
            "1",
            ttl_seconds=self.typing_ttl_s,
        )

    def typing_users(self, channel_id: str) -> list[str]:
        prefix = f"typing:{channel_id}:"
        return [k[len(prefix):] for k in self.store.keys(prefix)]


class InMemoryTTLStore:
    """Test-only TTL store. The runtime uses Redis."""

    def __init__(self, *, clock_ms: callable) -> None:
        self._values: dict[str, tuple[str, int]] = {}
        self._clock_ms = clock_ms

    def set_with_ttl(self, key: str, value: str, *, ttl_seconds: int) -> None:
        self._values[key] = (value, self._clock_ms() + ttl_seconds * 1000)

    def get(self, key: str) -> str | None:
        v = self._values.get(key)
        if v is None:
            return None
        value, expires_at = v
        if self._clock_ms() >= expires_at:
            self._values.pop(key, None)
            return None
        return value

    def keys(self, prefix: str) -> list[str]:
        live: list[str] = []
        for k in list(self._values.keys()):
            if not k.startswith(prefix):
                continue
            if self.get(k) is not None:
                live.append(k)
        return live
