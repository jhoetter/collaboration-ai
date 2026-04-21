"""Token-bucket maths: refill, take, retry-after."""

from __future__ import annotations

from domain.shared.rate_limit import Bucket, initial_bucket, take


def test_take_allowed_until_empty() -> None:
    b = initial_bucket("agent", "message", now_ms=0)  # cap=10, refill=0.2/s
    for _ in range(10):
        assert take(b, cost=1, now_ms=0).allowed is True
    res = take(b, cost=1, now_ms=0)
    assert res.allowed is False
    # 1 token / 0.2 per sec = 5 seconds = 5_000 ms
    assert res.retry_after_ms == 5_000


def test_take_refills_over_time() -> None:
    b = initial_bucket("agent", "message", now_ms=0)
    for _ in range(10):
        take(b, cost=1, now_ms=0)
    # Wait 30 seconds → 6 new tokens (capped at 10)
    res = take(b, cost=5, now_ms=30_000)
    assert res.allowed is True


def test_human_message_bucket_is_more_generous_than_agent() -> None:
    h = initial_bucket("human", "message", now_ms=0)
    a = initial_bucket("agent", "message", now_ms=0)
    assert h.capacity > a.capacity
    assert h.refill_per_sec > a.refill_per_sec
