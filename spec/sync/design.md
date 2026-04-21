# Phase 2 — Design

## Two transports, one cursor

Clients use whichever transport is available:

| Transport         | When                                    | Mechanics                                         |
| ----------------- | --------------------------------------- | ------------------------------------------------- |
| `GET /api/sync`   | First page load, cold reconnect, fallback | Long-poll: returns immediately if events exist past `since`; otherwise blocks 25 s waiting for new events on the workspace's Redis channel. |
| `GET /ws/events`  | Steady state                            | Bidirectional. Server pushes events, presence, typing. |

Both speak the same wire format: a `SyncMessage` envelope (see below)
with the same fields, just streamed differently.

```python
@dataclass
class SyncMessage:
    type: 'event' | 'presence' | 'typing' | 'control'
    workspace_id: str
    cursor: str  # encoded SyncCursor of the highest sequence in this batch
    events: list[Event] | None
    presence: list[PresenceUpdate] | None
    typing: list[TypingUpdate] | None
    control: ControlFrame | None
```

A `ControlFrame` is one of `ping`, `force-resync`, or `error`.

## Fan-out

```
PostgresCommitter → events table → projection worker → Redis PUBLISH
       │
       ▼
 channel: collabai:ws:{workspace_id}
       │
       ▼
 WS gateway demultiplexes to per-connection queues by room subscription
```

The projection worker publishes the **committed** event (with its
final `sequence`), not the envelope; subscribers replay it through the
same pure projector to keep their in-memory channel views fresh
without an extra DB round-trip.

## Bounded per-connection queue

Each WS connection gets an `asyncio.Queue(maxsize=256)`. If the queue
fills (slow client, network stall), the gateway:

1. Drops further fan-out for that connection.
2. Sends a `control: {kind: 'force-resync', cursor: <last delivered>}`
   frame.
3. The client closes and re-fetches via `/api/sync` from the cursor.

This guarantees we never silently drop events.

## Presence + typing

- `presence:{workspace_id}:{user_id}` — Redis SET with TTL=60 s.
  Refreshed on every `WS heartbeat` from the client. Ephemeral; never
  hits Postgres.
- `typing:{channel_id}:{user_id}` — Redis SET with TTL=4 s. Refreshed
  every 2 s while the user holds focus on the composer with non-empty
  content.

Presence and typing **are not events** in the log: they're
fire-and-forget hot signals. Read markers — which *do* carry semantics
across devices — *are* events.

## Backpressure on the publisher side

The projection worker writes to Redis with `XADD` to a per-workspace
stream (in addition to PUBLISH for the WS gateway). If a stream
exceeds `MAX_LEN ~ 50 000`, the oldest entries are trimmed. Late
subscribers fall back to `/api/sync` (which goes to Postgres) instead
of relying on the stream, so trimming is safe.

## Rate limits

Token-bucket math from `domain/shared/rate_limit.py`. Buckets live in
Redis; the bus' authoriser hook calls a `take(bucket, cost=1)` Lua
script. On rejection the bus returns:

```python
CommandResult(status='rejected', error=CommandError(
    code='rate_limited', message='Slow down',
    field=f'retry_after_ms={retry}',
))
```
