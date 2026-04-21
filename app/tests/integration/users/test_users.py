"""`users:upsert-anonymous` + `users:list` registration + SQL contract.

These tests live at the unit level — they exercise the SQL the
functions emit through a recording stub session (no real Postgres).
The functions acquire their own session via ``open_session``, so the
tests monkeypatch that context manager to yield the stub. The full
DB-backed contract is covered by ``tests/integration/scripts/
test_seed.py`` which calls the seed end-to-end.
"""

from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any

import pytest

from domain.users import functions as user_fns


@dataclass
class _StubResult:
    rows: list[dict[str, Any]] = field(default_factory=list)

    def mappings(self):  # noqa: ANN201 — sqlalchemy stub
        return self.rows

    def first(self):  # noqa: ANN201 — sqlalchemy stub
        return self.rows[0] if self.rows else None


@dataclass
class _StubSession:
    next_results: list[list[dict[str, Any]]] = field(default_factory=list)
    executed: list[tuple[str, dict[str, Any]]] = field(default_factory=list)
    commits: int = 0

    def execute(self, statement, params: dict[str, Any] | None = None):  # noqa: ANN201
        self.executed.append((str(statement), params or {}))
        if self.next_results:
            return _StubResult(rows=self.next_results.pop(0))
        return _StubResult()

    def commit(self) -> None:
        self.commits += 1


def _patch_open_session(monkeypatch: pytest.MonkeyPatch, session: _StubSession) -> None:
    """Make ``with open_session() as s:`` yield our stub inside the function."""

    @contextmanager
    def _fake_open_session():
        yield session

    monkeypatch.setattr("domain.users.functions.open_session", _fake_open_session)


def test_upsert_anonymous_runs_an_upsert_and_commits(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _StubSession()
    _patch_open_session(monkeypatch, session)

    out = user_fns.upsert_anonymous(
        user_id="u_anon_abc",
        display_name="Anonymous Bear",
    )

    assert out == {
        "user_id": "u_anon_abc",
        "display_name": "Anonymous Bear",
        "is_anonymous": True,
    }
    assert session.commits == 1
    assert len(session.executed) == 1

    sql, params = session.executed[0]
    assert "INSERT INTO users" in sql
    assert "ON CONFLICT (user_id) DO UPDATE" in sql
    assert params == {"user_id": "u_anon_abc", "display_name": "Anonymous Bear"}


def test_list_users_joins_workspace_members_with_users(monkeypatch: pytest.MonkeyPatch) -> None:
    session = _StubSession(
        next_results=[
            [
                {
                    "user_id": "u_anon_abc",
                    "display_name": "Anonymous Bear",
                    "is_anonymous": True,
                    "role": "member",
                },
                {
                    "user_id": "u_system",
                    "display_name": "System",
                    "is_anonymous": False,
                    "role": "owner",
                },
            ]
        ]
    )
    _patch_open_session(monkeypatch, session)

    out = user_fns.list_users(workspace_id="w_demo")

    sql, params = session.executed[0]
    assert "FROM workspace_members wm" in sql
    assert "LEFT JOIN users u" in sql
    assert params == {"w": "w_demo"}

    assert [u["user_id"] for u in out] == ["u_anon_abc", "u_system"]
    assert out[1]["display_name"] == "System"
