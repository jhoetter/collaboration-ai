"""Thin httpx wrapper around the collaboration-ai sidecar.

Lives in hof-os; talks to the sidecar over the compose-internal
network. The sidecar URL is read from the `COLLABAI_BASE_URL`
environment variable so the same code works under docker-compose,
local dev, and CI without rewiring.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class CollabClient:
    base_url: str
    timeout: float = 10.0

    @classmethod
    def from_env(cls) -> "CollabClient":
        return cls(base_url=os.environ.get("COLLABAI_BASE_URL", "http://collabai:8000"))

    def call(self, function_name: str, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url.rstrip('/')}/api/functions/{function_name}"
        with httpx.Client(timeout=self.timeout) as client:
            resp = client.post(url, json=payload)
            resp.raise_for_status()
            return resp.json()
