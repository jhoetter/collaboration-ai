# Phase 1 — Algorithms

## Replay

```python
def replay(workspace_id: str) -> ProjectedState:
    state = ProjectedState()
    cursor = 0
    while True:
        batch = events_table.scan(workspace_id, since=cursor, limit=10_000)
        if not batch:
            return state
        for evt in batch:
            project_event(state, evt)
        cursor = batch[-1].sequence
```

The projector is **idempotent on `event_id`** so a partially-applied
batch can be re-tried without consequence.

## Replay determinism check

`make replay-check` does:

1. Truncate every projection table.
2. Stream the events log into the projection runner.
3. Snapshot every projection table (sorted, hashed).
4. Truncate again, replay, snapshot again.
5. Assert the two snapshots are byte-identical.

CI runs this against the `tests/load/` fixture nightly.

## Idempotency commit

```sql
WITH ins AS (
  INSERT INTO events (...)
  SELECT ...
  ON CONFLICT (workspace_id, sender_id, idempotency_key) DO NOTHING
  RETURNING *
)
SELECT * FROM ins
UNION ALL
SELECT *
FROM events
WHERE workspace_id = $ws AND sender_id = $sid AND idempotency_key = $ik
  AND NOT EXISTS (SELECT 1 FROM ins);
```

The committer always sees a row back — either freshly inserted, or the
prior committed row.

## Sequence gap handling

The committer uses a single `SELECT … FOR UPDATE` on the
`workspace_sequence` row, so under no failure mode do we leave a gap.
If the transaction rolls back, the row stays at the prior value; a
later commit picks up where we left off.

A debug `make events-check` job verifies for each workspace:

```sql
SELECT MAX(sequence) - COUNT(*) AS gap
FROM events WHERE workspace_id = :ws;
```

`gap` must always be 0.
