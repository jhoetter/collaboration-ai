# Phase 1 — Event model + storage

## In scope

- `events` table (append-only, partitioned by `(workspace_id, month)`)
- All event types listed in [`spec/shared/event-model.md`](../shared/event-model.md)
- Pure-Python projector (`app/domain/events/projector.py`) — covered by
  [`tests/integration/events/test_projection_determinism.py`](../../app/tests/integration/events/test_projection_determinism.py)
  and `test_idempotency.py`
- Command bus + 16 default handlers (workspace / channel / chat / agent)
  — covered by `test_command_bus.py`
- Pydantic payload schemas (`app/domain/events/payloads.py`)
- Sync cursor helpers (`app/domain/shared/sync_cursor.py`) — covered
  by `test_sync_cursor.py`
- Token-bucket rate-limit math (`app/domain/shared/rate_limit.py`) —
  covered by `test_rate_limit.py`
- Attachment metadata table + presigned PUT/GET endpoints
- Postgres tsvector search index on the `messages` projection
- `make replay` harness that wipes projections and rebuilds from
  `events`

## Out of scope (deferred to later phases)

- Real-time fan-out (`/api/sync`, `/ws/events`) → Phase 2
- Notifications, scheduled messages, reminders → Phase 3
- MCP server + agent CLI → Phase 4
- Web UI → Phase 5

## Acceptance

- `make test-py` green.
- `make replay` reproduces every projection bit-for-bit.
- A 50 000-event log replays in < 5 s on a developer laptop.
- An attachment can be PUT, downloaded, and previewed (raster
  thumbnail) end-to-end against MinIO.
