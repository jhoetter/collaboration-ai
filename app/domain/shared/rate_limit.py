"""Token-bucket rate limiter (pure logic).

Lives behind the command bus to keep one human / one agent from flooding
the log. The state is normally held in Redis (Lua script for atomic
``decrement_or_block``); this module captures the math so the Redis
script stays trivial and the unit tests can fuzz the behaviour without
touching Redis.

A bucket has ``capacity`` tokens and refills at ``refill_per_sec``. A
take of ``cost`` tokens succeeds if and only if there are at least
``cost`` tokens available now (refill is computed on the fly from the
last update timestamp).
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True)
class Bucket:
    capacity: float
    refill_per_sec: float
    tokens: float
    updated_ms: int


@dataclass(slots=True, frozen=True)
class TakeResult:
    allowed: bool
    remaining: float
    retry_after_ms: int


def take(bucket: Bucket, *, cost: float, now_ms: int) -> TakeResult:
    """Try to take ``cost`` tokens. Mutates ``bucket`` in place."""
    if cost < 0:
        raise ValueError("cost must be non-negative")
    elapsed_ms = max(0, now_ms - bucket.updated_ms)
    bucket.tokens = min(bucket.capacity, bucket.tokens + bucket.refill_per_sec * (elapsed_ms / 1000.0))
    bucket.updated_ms = now_ms
    if bucket.tokens >= cost:
        bucket.tokens -= cost
        return TakeResult(allowed=True, remaining=bucket.tokens, retry_after_ms=0)
    deficit = cost - bucket.tokens
    if bucket.refill_per_sec <= 0:
        retry = -1
    else:
        retry = int(1000 * deficit / bucket.refill_per_sec)
    return TakeResult(allowed=False, remaining=bucket.tokens, retry_after_ms=retry)


# Default budgets per (sender_type, command_class). Values picked from
# prompt.md "rate limits per identity / per workspace / per channel"
# (lines around 280) — humans get a generous bucket, agents get a strict
# one because they can call in tight loops.
DEFAULT_BUDGETS: dict[tuple[str, str], tuple[int, float]] = {
    ("human", "message"): (60, 1.0),
    ("human", "reaction"): (120, 4.0),
    ("human", "read"): (600, 20.0),
    ("agent", "message"): (10, 0.2),
    ("agent", "propose"): (30, 0.5),
    ("agent", "read"): (600, 20.0),
    ("system", "*"): (10_000, 1000.0),
}


def initial_bucket(sender_type: str, command_class: str, *, now_ms: int) -> Bucket:
    cap, refill = DEFAULT_BUDGETS.get(
        (sender_type, command_class),
        DEFAULT_BUDGETS.get((sender_type, "*"), (60, 1.0)),
    )
    return Bucket(capacity=float(cap), refill_per_sec=float(refill), tokens=float(cap), updated_ms=now_ms)
