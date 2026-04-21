"""Auto-generated MCP server bridging the hof-engine `@function`
registry to MCP clients.

We deliberately keep this module pure-Python with a tiny adapter
shape so unit tests can drive `dispatch_tool` directly without
spawning a real MCP transport.

The actual stdio binding is in `bin/collabai-mcp` (Phase 5 wiring).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .audit import AuditRecord, AuditSink
from .registry import FunctionEntry, all_entries, get, mcp_entries
from .scopes import AgentIdentity, check_scope


@dataclass(slots=True)
class ToolDescriptor:
    name: str
    description: str
    input_schema: dict[str, Any]
    scope: str | None


def list_tools() -> list[ToolDescriptor]:
    return [
        ToolDescriptor(
            name=e.name,
            description=e.docstring or e.name,
            input_schema=e.input_schema,
            scope=e.mcp_scope,
        )
        for e in mcp_entries()
    ]


@dataclass(slots=True)
class ToolResult:
    ok: bool
    output: Any
    audit: AuditRecord | None = None

    def to_dict(self) -> dict[str, Any]:
        out: dict[str, Any] = {"ok": self.ok, "output": self.output}
        if self.audit is not None:
            out["audit_id"] = self.audit.command_id
        return out


def dispatch_tool(
    name: str,
    arguments: dict[str, Any],
    *,
    identity: AgentIdentity,
    audit_sink: AuditSink,
) -> ToolResult:
    entry = get(name)
    if entry is None or not entry.mcp_expose:
        return ToolResult(ok=False, output={"error": "unknown_tool", "tool": name})

    denied = check_scope(identity, entry.mcp_scope)
    if denied is not None:
        return ToolResult(ok=False, output=denied.to_dict())

    # Inject `actor_id` + `workspace_id` from the identity if the function
    # accepts them and the caller didn't supply them explicitly. Agents
    # are addressed via their identity, never by passing a raw user id.
    if "actor_id" in entry.input_schema.get("properties", {}) and "actor_id" not in arguments:
        arguments["actor_id"] = identity.agent_id
    if "workspace_id" in entry.input_schema.get("properties", {}) and "workspace_id" not in arguments:
        arguments["workspace_id"] = identity.workspace_id

    try:
        output = entry.callable(**arguments)
    except TypeError as exc:
        return ToolResult(ok=False, output={"error": "invalid_arguments", "message": str(exc)})
    except Exception as exc:  # pragma: no cover
        return ToolResult(ok=False, output={"error": "internal", "message": str(exc)})

    audit = audit_sink.record(
        AuditRecord(
            command_id=output.get("command_id") if isinstance(output, dict) else "",
            agent_id=identity.agent_id,
            workspace_id=identity.workspace_id,
            tool_name=name,
            arguments=arguments,
            decision=output.get("status", "applied") if isinstance(output, dict) else "applied",
            event_ids=[e.get("event_id") for e in (output.get("events") if isinstance(output, dict) else []) or []],
        )
    )
    return ToolResult(ok=True, output=output, audit=audit)


def tools_summary() -> dict[str, Any]:
    """Lightweight machine-readable summary used by `collab-agent --help`."""
    return {
        "total": len(all_entries()),
        "exposed": len(mcp_entries()),
        "tools": [t.name for t in list_tools()],
    }
