# Phase 2 — Sync engine + real-time

## In scope

- HTTP `GET /api/sync?since=:cursor` long-poll (25 s deadline)
- WebSocket `GET /ws/events` for real-time deltas
- Redis pub/sub channel-per-workspace fan-out from the projection
  worker
- Presence (`active`, `away`, `dnd`) — Redis TTL keyed on
  `presence:{workspace_id}:{user_id}`
- Typing notifications — Redis TTL with a 4 s key
- Per-connection bounded queue (backpressure → force-resync on
  overflow)
- Per-(sender, command_class) token-bucket rate limits enforced inside
  the command bus
- Multi-client coherence harness — 5 clients, 3 channels, network
  split + reconnect with stored cursor (per `prompt.md` §Sync Fixtures)

## Out of scope

- Federation between independent collaboration-ai instances
- E2EE (Phase 1 puts `content` in plaintext for search; encrypted DMs
  are a future phase)

## Acceptance

- A laptop and a phone subscribed to the same workspace see new
  messages within 200 ms median, 1 s P99 over the dev stack.
- Killing the WebSocket and reconnecting with the stored cursor
  delivers exactly the missed events, in order, with no duplicates.
- A flaky client that hits its bounded queue receives a `force-resync`
  control frame and re-fetches via `/api/sync` without losing data.
- Presence keys expire automatically; restarting the server returns
  presence to "offline" within the TTL window.
