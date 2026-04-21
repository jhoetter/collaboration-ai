"""Stdio transport for the auto-generated MCP server.

Tiny json-rpc loop so `collab-agent mcp serve` can spawn this binary
and pipe an MCP client into it. The actual MCP wire protocol is more
involved; we keep this file deliberately minimal and rely on the
upstream `mcp` Python package for production. The shape here is what
unit tests + `collab-agent mcp ping` exercise.
"""

from __future__ import annotations

import json
import sys
from typing import Any

from .audit import ListAuditSink
from .mcp_server import dispatch_tool, list_tools
from .scopes import AgentIdentity


def serve_stdio(*, identity: AgentIdentity, sink: ListAuditSink | None = None) -> None:  # pragma: no cover
    audit = sink or ListAuditSink()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            req = json.loads(line)
        except json.JSONDecodeError as exc:
            sys.stdout.write(json.dumps({"error": "invalid_json", "message": str(exc)}) + "\n")
            sys.stdout.flush()
            continue
        method = req.get("method")
        if method == "tools/list":
            response: dict[str, Any] = {
                "id": req.get("id"),
                "result": {
                    "tools": [
                        {
                            "name": t.name,
                            "description": t.description,
                            "inputSchema": t.input_schema,
                            "scope": t.scope,
                        }
                        for t in list_tools()
                    ]
                },
            }
        elif method == "tools/call":
            params = req.get("params") or {}
            res = dispatch_tool(
                params.get("name", ""),
                params.get("arguments") or {},
                identity=identity,
                audit_sink=audit,
            )
            response = {"id": req.get("id"), "result": res.to_dict()}
        else:
            response = {"id": req.get("id"), "error": {"code": -32601, "message": "method not found"}}
        sys.stdout.write(json.dumps(response) + "\n")
        sys.stdout.flush()
