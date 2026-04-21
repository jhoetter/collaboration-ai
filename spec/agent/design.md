# Phase 4 — Agent API: Design

## Architecture

```
+----------------------+
|   Agent (any LLM)    |
+----------------------+
        |
        |  MCP (json-rpc) or HTTPS
        v
+----------------------+      +-----------------------+
|  collab-agent (TS)   |----->|  collabai FastAPI     |
|                      |      |  (hof-engine app)     |
+----------------------+      +-----------+-----------+
        |                                 |
        |   collab-agent mcp serve        |
        v                                 v
+----------------------+      +-----------------------+
| collabai-mcp (Py)    |----->|  command bus + bus    |
| auto-discovers       |      |  staging + audit log  |
| @function registry   |      +-----------------------+
+----------------------+
```

## MCP server (Python)

* Lives in `app/domain/agent_api/mcp_server.py`.
* On startup it walks the global `hof.function` registry and emits one
  MCP "tool" per `@function` annotated with `mcp_expose=True`.
* Each tool's input schema = the function's Pydantic-derived schema.
* Each tool's invocation = build a `Command` (or call the function
  directly for read endpoints), check the agent's scope ⊆
  `function.mcp_scope`, dispatch via the command bus, and return the
  serialised `CommandResult` or function output.
* Authentication: every connection requires an agent api key carried
  in the MCP `Authorization` header. The key resolves to an
  `agents[agent_id]` row + scope set.

## TypeScript CLI

* Package: `@collabai/agent-cli`.
* Entry: `bin/collab-agent.ts` → compiled to `dist/cli.cjs`.
* Uses `commander` for subcommand routing and `undici`/`fetch` for
  HTTPS to the FastAPI surface.
* `mcp serve` spawns the Python `collabai-mcp` server as a subprocess
  and proxies stdio (so external MCP clients only need the JS
  package).
* Auth: `collab-agent login` opens a device flow against the FastAPI
  `/api/agent-auth/device` endpoint, persists the resulting token in
  `~/.collab-agent/token.json`.

## Audit trail

* Table: `agent_audit(command_id, agent_id, command_type, channel_id,
  decision, event_ids, created_at)`.
* The bus calls `agent_audit_repo.record(cmd, result)` whenever
  `cmd.source == "agent"`.
* Replaying the log → projector reconstructs `state.audit` keyed by
  agent_id; CLI surface: `collab-agent audit --since 1h`.

## Budgets / rate limits

* The token-bucket helper from Phase 1 is parameterised on
  `(agent_id, command_type)`.
* Default agent bucket: 60 messages / hour and 600 reads / hour.
* Workspace admins can override via `agents:set-budget(agent_id, …)`.
