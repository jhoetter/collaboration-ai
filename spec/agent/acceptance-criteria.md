# Phase 4 — Agent API: Acceptance Criteria

## A. MCP discovery

1. The MCP server emits one tool per `@function` with
   `mcp_expose=True`.
2. Each tool's input schema matches the function's parameter Pydantic
   model.
3. Calling a tool with a missing scope returns
   `{"error": "scope_denied", "required_scope": "<x>"}` and emits no
   command.

## B. Staging policy

1. In a `fully-autonomous` channel an agent's `chat:send-message`
   commits as a `message.send` directly.
2. In an `agent-messages-require-approval` channel the same command
   commits as `agent.proposal.create` (`status="pending"`).
3. In an `all-require-approval` channel both human and agent commands
   stage.

## C. Audit trail

1. Every command with `source="agent"` writes one
   `agent_audit` row with the same `command_id` returned to the
   caller.
2. Approval / rejection of a staged proposal links back to the
   originating audit row via `proposal_id`.

## D. Budgets

1. After exhausting a daily bucket the bus rejects with
   `code="rate_limited"`.
2. Override via `agents:set-budget` immediately re-enables the agent.

## E. CLI

1. `collab-agent send --channel ch_general --content "hi"` returns
   the resulting `command_id` and `event_id`.
2. `collab-agent unread` returns one row per channel, sorted by
   mention count descending then by unread descending.
3. `collab-agent mcp serve` launches the Python MCP bridge and
   relays stdio.
