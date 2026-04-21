# Agent API

Per `prompt.md` lines 454-486 — the agent surface is **just the
`@function` API**. There is no parallel "v1 agent route". This is the
"single API surface" rule from `hof-os/AGENTS.md` §A3.

## Shape (Python, mirrors prompt.md TS interface)

```python
class CollaborationAgent(Protocol):
    # Read
    def list_channels(self) -> list[ChannelInfo]: ...
    def list_messages(self, channel_id: str, *, since_seq: int | None = None,
                      limit: int = 100) -> list[Message]: ...
    def search_messages(self, q: str, *, channel_ids: list[str] | None = None,
                        from_user: str | None = None) -> list[Message]: ...
    def list_threads(self, channel_id: str) -> list[ThreadInfo]: ...

    # Write (subject to staging policy)
    def send_message(self, channel_id: str, content: str, *,
                     thread_root: str | None = None,
                     mentions: list[str] | None = None,
                     attachments: list[Attachment] | None = None) -> CommandResult: ...
    def edit_message(self, message_id: str, new_content: str) -> CommandResult: ...
    def add_reaction(self, message_id: str, emoji: str) -> CommandResult: ...

    # Propose (always staged regardless of policy)
    def propose_message(self, channel_id: str, content: str, *,
                        rationale: str | None = None) -> CommandResult: ...

    # Watch (real-time)
    def stream_events(self, channel_id: str | None = None) -> AsyncIterator[Event]: ...
```

## Generation

The Python class above is **generated** at build time from the
`@function` registry; we don't hand-write it. The TypeScript client
that the web UI uses is generated from the same registry by an
`hof export-client --target=ts` step (mirroring hof-os's
`packages/api-client`).

## MCP

`app/domain/shared/mcp_server.py` walks the function registry and emits
one MCP tool per `@function` decorated with `mcp_expose=True`. The
tool's input schema is derived from the function's signature; the
output is the function's return shape. An MCP-aware agent (Claude
Desktop, mcp-cli, etc.) can `connect → list_tools → call_tool` against
a workspace without any custom adapter.

## Staging + budgets

- A channel's `staging_policy` decides whether a write call from an
  agent goes through directly or becomes a proposal (see
  `command-bus.md`).
- An agent's per-(workspace, command_class) budget is enforced via the
  token-bucket in `domain/shared/rate_limit.py`. Defaults are stricter
  for agents than for humans; see `DEFAULT_BUDGETS`.

## Audit

Every agent action carries `agent_id`, `actor_id` (the human who gave
the agent its token, if applicable), and `command_id`. The audit log
in `events` is the same one human actions land in.
