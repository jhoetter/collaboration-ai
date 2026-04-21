# Phase 1 — Design

## Sequence assignment

We use one Postgres `BIGSERIAL` per workspace, stored in a
`workspace_sequence` row taken FOR UPDATE inside the commit transaction:

```sql
WITH next AS (
  UPDATE workspace_sequence
  SET seq = seq + cardinality($events)
  WHERE workspace_id = $ws
  RETURNING seq - cardinality($events) AS base
)
INSERT INTO events (workspace_id, sequence, …)
SELECT $ws, (next.base + ord), …
FROM unnest($events) WITH ORDINALITY AS e(payload, ord), next;
```

Why a row per workspace, not one global serial? Two reasons:

1. **Hot-path contention.** A global serial would serialise commits
   across workspaces; per-workspace lets us scale horizontally.
2. **Sync cursor stability.** Clients store `(workspace_id, sequence)`;
   if sequence were global, joining a new workspace would invalidate
   the cursor.

## Idempotency key handling

The committer does an `INSERT … ON CONFLICT (workspace_id, sender_id,
idempotency_key) DO NOTHING RETURNING …` and, if no rows return, looks
up the previously-committed event by the same key and returns it. The
client sees a successful `CommandResult` either way.

## Projector design

The pure projector functions in
[`app/domain/events/projector.py`](../../app/domain/events/projector.py)
mutate a `ProjectedState` dataclass in place. The hof-engine
**projector runner** wraps these functions with a `StateProxy` whose
mutations translate dict assignments into SQL upserts on the
projection tables:

```python
class StateProxy:
    def __setitem__(self, k, v):
        # 'channels[ch_id]' → upsert one row in `channels`
        ...
```

This keeps the pure-Python projector usable both:

- in unit tests (with a real `ProjectedState`),
- in the runtime projection worker (with the SQL-emitting proxy).

Replays use the pure projector against an empty `ProjectedState`, then
diff the result against the live projection tables — any mismatch is a
bug.

## Attachments

The `attachment:upload-init` `@function` returns:

```json
{
  "file_id": "att_…",
  "put_url": "<presigned PUT, 5-minute TTL>",
  "headers": {"Content-Type": "...", "x-amz-checksum-sha256": "..."},
  "object_key": "workspaces/<ws>/attachments/<file_id>"
}
```

The client uploads, then calls `attachment:upload-finalise` which
records the `Attachment` row, kicks off the thumbnail Celery job, and
returns the metadata for embedding in the next `chat:send-message`.

## Search

A trigger on the `messages` projection updates `message_search.tsv`
on insert/update. Per-channel `text_search_config` (default `simple`)
can be set so multilingual content stays searchable.

```sql
CREATE TRIGGER messages_tsv_update
BEFORE INSERT OR UPDATE OF content, redacted ON messages
FOR EACH ROW EXECUTE FUNCTION update_message_tsv();
```

`update_message_tsv` builds the vector from
`(content || sender_name || channel_name)` weighted by relevance.
