# Event model

Every observable change is an event. Same envelope as `prompt.md` lines
406-424, expressed in Python:

```python
@dataclass
class Event:
    event_id: str           # UUIDv7
    type: EventType         # one of EVENT_TYPES
    content: dict[str, Any] # validated by domain/events/payloads.py
    workspace_id: str
    room_id: str            # channel_id, dm_id, or workspace_id for ws-level events
    sender_id: str          # user_id or agent_id
    sender_type: 'human' | 'agent' | 'system'
    origin_ts: int          # server wall clock, ms
    sequence: int           # workspace-monotonic, assigned at commit
    agent_id: str | None
    relates_to: RelatesTo | None
    idempotency_key: str | None
    origin: dict | None     # bridge provenance (Phase 6)
```

`relates_to` carries `m.replace` (edit), `m.reaction`, `m.thread`, or
`m.redact` and is the only way one event refers to another.

## Event taxonomy

The complete frozenset of types lives in
[`app/domain/events/model.py`](../../app/domain/events/model.py). The
groups:

- **Workspace** — `workspace.create / .update / .member.add / .member.remove / .member.role-set`
- **Channels** — `channel.create / .update / .archive / .unarchive / .member.{join,leave,invite,kick} / .pin.{add,remove} / .topic.set`
- **Messages** — `message.send / .edit / .redact`
- **Reactions** — `reaction.{add,remove}`
- **Read markers** — `read.marker`
- **Drafts** — `draft.{set,clear}`
- **User meta** — `user.status.set / .presence.set / .snooze.set`
- **Agents** — `agent.identity.register / .proposal.{create,approve,reject,edit-and-approve}`
- **Bridges** — `bridge.import.message`

Adding a new event type is a four-step PR: add it to `EVENT_TYPES`,
write its Pydantic payload schema, add a projection function, register
the dispatch entry. Tests under `tests/integration/events/` cover the
projection slice; tests under `tests/integration/agent/` cover MCP
exposure if applicable.

## Sequence assignment

The `sequence` is workspace-monotonic. It is **not** assigned by the
client; it is assigned by the committer (one Postgres `BIGSERIAL` per
workspace, looked up from a sequence-generator table inside the
transaction that appends the event). This guarantees:

- Causal order: any event is strictly after every event with a smaller
  sequence in the same workspace.
- Sync cursor stability: a cursor `(workspace, sequence=N)` always means
  "I have seen exactly events 1..N", even if events arrived from
  multiple committers concurrently.

## Idempotency

`(workspace_id, sender_id, idempotency_key)` is unique. The committer
performs an upsert; a duplicate command returns the **already-committed**
event without appending a second one. This makes "retry on transient
failure" safe in every client.

Even without the unique index, the projector deduplicates on
`event_id`: replaying a committed event twice (e.g. during recovery)
leaves projection state untouched. See
[`app/tests/integration/events/test_idempotency.py`](../../app/tests/integration/events/test_idempotency.py).

## Causal ordering rules

- An `m.replace`, `m.reaction`, or `m.redact` event is meaningful only
  if its `relates_to.event_id` already exists in the projection. The
  projector skips dangling references silently; the loader replays
  events in `sequence` order so this never happens in practice.
- A redaction is **terminal**: subsequent edits / reactions on the same
  message are no-ops.
- Read markers are monotonic per `(user_id, channel_id)`. Backwards
  markers are dropped silently — useful when a tab on a phone is behind
  the desktop.
