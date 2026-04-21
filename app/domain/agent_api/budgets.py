"""Per-agent rate limits / daily budgets.

Wraps `domain.shared.rate_limit` with a per-(agent_id, command_class)
key. The bus calls `take_for_agent` before dispatching an agent
command; on `False` the bus returns `code="rate_limited"`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from ..shared.rate_limit import Bucket, take

CommandClass = Literal["message", "read", "admin"]

# (capacity_tokens, refill_per_second) per command class.
_DEFAULTS: dict[CommandClass, tuple[float, float]] = {
    "message": (60.0, 60.0 / 3600.0),  # 60 / hour, drip-refilled
    "read": (600.0, 600.0 / 3600.0),
    "admin": (10.0, 10.0 / 3600.0),
}


def classify(command_type: str) -> CommandClass:
    if command_type.startswith("chat:") and ("send" in command_type or "schedule" in command_type or "reminder" in command_type):
        return "message"
    if command_type.startswith(("workspace:", "channel:")) and (
        "set" in command_type or "invite" in command_type or "kick" in command_type
    ):
        return "admin"
    return "read"


@dataclass
class AgentBudgets:
    overrides: dict[tuple[str, CommandClass], tuple[float, float]] = field(default_factory=dict)
    _state: dict[tuple[str, CommandClass], Bucket] = field(default_factory=dict)

    def set_budget(
        self, agent_id: str, klass: CommandClass, capacity: float, refill_per_second: float
    ) -> None:
        self.overrides[(agent_id, klass)] = (capacity, refill_per_second)
        self._state.pop((agent_id, klass), None)

    def take_for_agent(
        self, agent_id: str, command_type: str, *, now_ms: int, cost: float = 1.0
    ) -> bool:
        klass = classify(command_type)
        key = (agent_id, klass)
        capacity, refill = self.overrides.get(key, _DEFAULTS[klass])
        bucket = self._state.get(key)
        if bucket is None:
            bucket = Bucket(
                capacity=capacity, refill_per_sec=refill, tokens=capacity, updated_ms=now_ms
            )
        result = take(bucket, cost=cost, now_ms=now_ms)
        self._state[key] = bucket
        return result.allowed
