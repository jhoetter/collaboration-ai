# Phase 4 — Agent API + CLI + MCP

## Goal

Make every `@function` endpoint addressable by:

* HTTPS (the FastAPI surface that hof-engine already auto-generates).
* MCP, via an auto-generated server that reflects on the function
  registry and exposes each tool with its docstring + Pydantic
  signature.
* A small TypeScript CLI (`collab-agent`) that humans + agents both
  use to script flows ("send message", "list unread", "approve all
  pending proposals from agent X").

## In scope

* Agent identity (`agents` table) with scopes, rate limit overrides,
  and an audit log entry for every command they run.
* MCP server bridge that auto-discovers all hof-engine `@function`
  endpoints with `mcp_expose=True`, emits the JSON Schema of their
  parameters, and dispatches calls onto the same command bus.
* `collab-agent` CLI: `login`, `who-am-i`, `send`, `read <channel>`,
  `unread`, `notifications`, `approve <proposal>`, `reject
  <proposal>`, `mcp serve`, plus a generic `call <function-name>
  --json …` escape hatch.
* Per-channel staging policies (`fully-autonomous`,
  `auto-send-with-badge`, `agent-messages-require-approval`,
  `all-require-approval`) — already projected in Phase 1, enforced in
  the bus.
* Per-agent budgets: a daily token-bucket cap on commands enforced by
  `app/domain/shared/rate_limit.py`.
* Audit trail: every command from `source="agent"` is recorded in an
  `agent_audit` table with command_id, agent_id, decision (applied /
  staged / rejected), and the resulting event_ids.

## Out of scope

* LLM orchestration (`hof-engine` already provides primitives; the
  CLI just exposes function calls).
* Multi-agent coordination protocols beyond what MCP gives us.
