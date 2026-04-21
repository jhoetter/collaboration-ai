"""Scope checks for MCP tool invocations.

Scopes are simple string identifiers like ``read:messages``. The
agent's identity carries a set of allowed scopes; each `@function`
declares a single required scope (or `None` for read-only public
endpoints). Authorisation is set membership.
"""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(slots=True, frozen=True)
class AgentIdentity:
    agent_id: str
    workspace_id: str
    scopes: frozenset[str]


@dataclass(slots=True, frozen=True)
class ScopeDenied:
    required_scope: str

    def to_dict(self) -> dict[str, str]:
        return {"error": "scope_denied", "required_scope": self.required_scope}


def check_scope(identity: AgentIdentity, required_scope: str | None) -> ScopeDenied | None:
    if required_scope is None:
        return None
    if required_scope in identity.scopes:
        return None
    return ScopeDenied(required_scope=required_scope)
