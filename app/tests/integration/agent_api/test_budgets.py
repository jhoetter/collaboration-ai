"""Per-agent token-bucket budgets."""

from __future__ import annotations

from domain.agent_api.budgets import AgentBudgets, classify


def test_classify_routes_known_command_types() -> None:
    assert classify("chat:send-message") == "message"
    assert classify("chat:schedule-message") == "message"
    assert classify("workspace:invite") == "admin"
    assert classify("chat:list-messages") == "read"


def test_message_bucket_eventually_runs_out() -> None:
    b = AgentBudgets()
    # Default: 60 messages
    for _ in range(60):
        assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is True
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is False


def test_override_increases_capacity() -> None:
    b = AgentBudgets()
    b.set_budget("agent:bot", "message", capacity=2.0, refill_per_second=0.0)
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is True
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is True
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is False


def test_separate_classes_have_separate_buckets() -> None:
    b = AgentBudgets()
    b.set_budget("agent:bot", "message", capacity=1.0, refill_per_second=0.0)
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is True
    assert b.take_for_agent("agent:bot", "chat:send-message", now_ms=0) is False
    # Reads are still allowed.
    assert b.take_for_agent("agent:bot", "chat:list-messages", now_ms=0) is True
