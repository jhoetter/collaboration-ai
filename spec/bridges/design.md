# Bridges — Design

## Module layout

```
app/domain/bridges/
  __init__.py
  slack/
    __init__.py
    parser.py        # parse a Slack export tree into BridgeEvents
    importer.py      # turn BridgeEvents into command bus calls
  matrix/
    __init__.py
    client.py        # tiny `/sync` poller (no SDK dependency)
    importer.py      # turn /sync chunks into BridgeEvents
  protocol.py        # BridgeEvent dataclass — provider-neutral shape
  policy.py          # `is_bridge_enabled(workspace_id, provider)`
  flows.py           # hof-engine flows: slack_import, matrix_poll
```

## Provider-neutral shape

All bridges normalise to one shape so the importer code is shared:

```python
@dataclass(frozen=True)
class BridgeEvent:
    provider: Literal["slack", "matrix"]
    external_channel_id: str
    external_message_id: str
    external_user_id: str
    external_user_display: str
    external_ts: float
    text: str
    thread_root: str | None
    is_edit_of: str | None
```

The importer translates each `BridgeEvent` into a `chat:send-message`
command issued under a synthetic system user (`bridge:slack` /
`bridge:matrix`) with `sender_type="system"`. The original ids and
timestamps are stored in the event's `metadata` field so search and
audit can quote them.

## Channel mapping

- Each provider gets a deterministic prefix:
  `slack-archive/<workspace>/<channel-name>`,
  `matrix-archive/<room-id>`.
- The importer creates the channel via `channel:create` if missing,
  marks it `archive=true`, and stores the `external_channel_id` in
  the channel projection so re-imports are idempotent.

## Idempotency

- Slack: hash the export `.zip` + channel name + message ts. The
  importer keeps a `bridges.imported_keys` set in the projection so
  repeat imports skip already-imported messages.
- Matrix: persist the `next_batch` token per (workspace, room). On
  restart, the poller resumes from there. The importer also tracks
  per-message ids to defend against accidental rewinds.

## Auth & policy

- `bridges` is opt-in per workspace via a `workspace.bridges` event
  emitted from admin settings. `policy.is_bridge_enabled` reads the
  projection — the importer is a hard no-op when disabled.
- The bridge identity is treated like an agent for budget purposes:
  rate-limited via `agent_api.budgets`, with a fixed `bridge:<id>`
  agent identity. This reuses the existing audit + budget plumbing.

## Flows

- `slack_import(export_path, workspace_id)` — long-running flow,
  reports progress every 100 messages, records final stats.
- `matrix_poll(workspace_id)` — Celery beat job that runs every 30s,
  one task per workspace, with a redis lock to prevent overlap.

Both flows emit `bridge.import.progress`, `bridge.import.complete`,
and `bridge.import.failed` system events that the admin UI subscribes
to via the existing sync engine — no new transport.
