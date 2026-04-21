"""Audit log for agent actions.

Every command issued via MCP / agent CLI lands here. The production
implementation writes to an `agent_audit` table; the tests use the
in-memory `ListAuditSink`.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass(slots=True)
class AuditRecord:
    command_id: str
    agent_id: str
    workspace_id: str
    tool_name: str
    arguments: dict[str, Any]
    decision: str  # applied | staged | rejected | failed
    event_ids: list[str | None] = field(default_factory=list)


class AuditSink(Protocol):
    def record(self, record: AuditRecord) -> AuditRecord: ...

    def for_agent(self, agent_id: str) -> list[AuditRecord]: ...


@dataclass(slots=True)
class ListAuditSink:
    records: list[AuditRecord] = field(default_factory=list)

    def record(self, record: AuditRecord) -> AuditRecord:
        self.records.append(record)
        return record

    def for_agent(self, agent_id: str) -> list[AuditRecord]:
        return [r for r in self.records if r.agent_id == agent_id]
