# Command bus

Per `prompt.md` lines 426-446 — every state change goes through one
typed entry point. Implementation lives in
[`app/domain/shared/command_bus.py`](../../app/domain/shared/command_bus.py).

## Shape

```python
@dataclass
class Command:
    type: str                       # 'chat:send-message', 'channel:create', …
    payload: dict[str, Any]         # validated by Pydantic schema
    source: 'human' | 'agent' | 'system'
    actor_id: str                   # user_id or agent_id
    workspace_id: str
    session_id: str | None
    agent_id: str | None
    idempotency_key: str | None
    command_id: str                 # UUIDv7, server-assigned
    room_id: str | None             # optional channel routing
```

```python
@dataclass
class CommandResult:
    command_id: str
    status: 'applied' | 'staged' | 'rejected' | 'failed'
    events: list[Event]             # the events the command produced
    proposal_id: str | None         # set when status == 'staged'
    error: CommandError | None
```

## Pipeline

```
        ┌──────────────────────────────────────────────────────────────┐
        │ CommandBus.dispatch(cmd)                                     │
        ├──────────────────────────────────────────────────────────────┤
        │ 1. Lookup handler. Unknown → status='rejected', error code   │
        │    'unknown_command'.                                        │
        │ 2. Pydantic-validate payload against the registered schema.  │
        │    Failure → 'rejected', code='invalid_payload'.             │
        │ 3. Authoriser hook (per command). Failure → 'rejected',      │
        │    code='forbidden'.                                         │
        │ 4. Handler builds zero or more EventEnvelopes.               │
        │ 5. Committer assigns sequences, persists in one Postgres tx, │
        │    returns the committed Events. Conflict → 'failed'.        │
        │ 6. Synchronous projection into the in-process state cache;   │
        │    the durable projection happens in a Celery worker.        │
        │ 7. Return CommandResult.                                     │
        └──────────────────────────────────────────────────────────────┘
```

## Where commands come from

- HTTP `POST /api/functions/<entity>:<verb>` — every `@function`
  endpoint in `app/domain/<entity>/functions.py` builds a `Command`
  and dispatches it.
- WebSocket `/ws/events` (Phase 2) — same payload shape, multiplexed.
- `collab-agent` CLI (Phase 4) — wraps `hof_call("entity:verb", ...)`,
  which is the exact same `@function` API.
- MCP server (Phase 4) — auto-generates one tool per `@function`
  marked `mcp_expose=True`; the tool's input schema is the same
  Pydantic model.

This is the "single API surface" principle from `hof-os/AGENTS.md` §A3:
**no command path bypasses the bus**.

## Staging policy

`channels.staging_policy` ∈
- `all-require-approval` — every command (human or agent) goes through
  approval. Useful for compliance channels.
- `agent-messages-require-approval` — default. Human commands go
  through; agent commands stage as proposals.
- `auto-send-with-badge` — agent posts immediately, but UI badges the
  message and the command bus notifies the channel's reviewers.
- `fully-autonomous` — no review. Reserved for sandboxes or trusted
  agent rooms.

The bus enforces this by checking `state.channels[channel_id]
.staging_policy` *before* calling the handler. If staging is required,
the handler returns an `agent.proposal.create` envelope instead of the
underlying `message.send`. The CommandResult's `status` becomes
`'staged'`, and `proposal_id` is set so the agent / UI can poll for
approval.

## Audit trail

Every committed event carries the originating `command_id` in its
metadata; combined with the per-event `sender_id` and `agent_id`, a
single SQL query reconstructs "who did what, on whose behalf, when, in
which command":

```sql
SELECT origin_ts, type, sender_id, agent_id, content
FROM events
WHERE workspace_id = :ws AND content->>'command_id' = :cmd
ORDER BY sequence;
```
