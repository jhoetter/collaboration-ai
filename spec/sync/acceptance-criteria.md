# Phase 2 — Sync Engine + Real-Time: Acceptance Criteria

These are the executable, demo-able checks that gate "Phase 2 done".
Each criterion maps to one or more integration tests in
`app/tests/integration/sync/`.

## A. Long-poll `/api/sync`

1. A new client with `cursor=0` for a freshly-bootstrapped workspace
   receives the full event log in arrival order.
2. A client whose cursor is already at the head is held open until the
   next event is committed (or the configured `wait_ms` elapses).
3. A client with a cursor *ahead of* the server's head receives an
   empty page and an unchanged cursor (no crash, no negative deltas).
4. A client whose cursor cannot be decoded falls back to `0`
   (`test_garbage_input_falls_back_to_zero`).
5. The response payload is bounded by `max_events ≤ 2_000`.

## B. WebSocket `/ws/events`

1. Connecting with a valid identity + workspace_id subscribes the
   socket to the workspace fanout and (optionally) a room subset.
2. Each committed event is delivered to all subscribers whose room
   filter matches in **commit order** within a workspace.
3. The server sends a `control` frame `{"kind": "force-resync",
   "cursor": <last>}` when the per-socket bounded queue overflows.
4. Disconnect is graceful on both client-initiated `close` and
   server-side cancellation; queues are released and presence TTL
   takes over (the user's status decays to `offline`).

## C. Redis fan-out

1. Events committed on pod A are received by subscribers on pod B
   within one Redis round-trip
   (`test_round_trip_preserves_all_fields` covers the codec; the
   end-to-end check is the docker-compose smoke run).
2. Per-workspace channel naming (`collabai:events:{workspace_id}`)
   prevents cross-tenant leakage
   (`test_channel_naming_isolates_workspaces`).
3. The bridge survives transient Redis disconnects without dropping
   the local fanout subscriptions (reconnect loop in `RedisFanout`).

## D. Presence + typing

1. `heartbeat()` sets a workspace user's status with a TTL; lookups
   return `offline` after expiry
   (`test_presence_set_get_expire`).
2. `typing_start()` is per-channel and decays after 4s by default
   (`test_typing_users_are_listable_per_channel`).
3. `workspace_presence()` returns only currently-live users and their
   status (`test_workspace_presence_returns_only_live_users`).

## E. Multi-client coherence harness

1. Five virtual clients across three channels, all subscribed to the
   same fanout, converge to the **same projected state** after a burst
   of sends (`test_five_clients_converge_after_split_and_reconnect`,
   Phase A).
2. After a network split where one client misses 30 events and
   reconnects via long-poll, that client converges with the other four
   (Phase B + C).
3. A subscriber whose queue is too small to keep up with the publish
   rate receives an `on_overflow` callback and is marked in
   `overflowed_subscription_ids`
   (`test_overflow_subscribers_get_force_resync_signal`).

## F. Backpressure + safety

1. `BoundedQueue` never grows past `maxsize`; subsequent `put()`s
   return `False` (drop-newest semantics, callers are responsible for
   triggering force-resync).
2. The fanout never raises; failed deliveries flip the subscription
   into `overflowed_subscription_ids` for cleanup by the gateway.

## G. Wire format

1. Each event is serialised through `Event.to_dict()` /
   `Event.from_dict()` so projector logic stays the source of truth
   and Redis payloads are deterministic
   (`json.dumps(..., sort_keys=True)`).
