# Phase 1 — Acceptance criteria

Phase 1 is **done** when:

| #   | Gate                                                                                           | Evidence                                                                                                    |
| --- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Replaying any event log twice produces identical state.                                        | `tests/integration/events/test_projection_determinism.py` green.                                            |
| 2   | Replaying a single event twice is a no-op.                                                     | `tests/integration/events/test_idempotency.py` green.                                                       |
| 3   | Edits are applied in commit order; redactions are terminal.                                    | `test_edit_after_redact_is_dropped` + `test_chat_send_then_edit_then_redact` green.                         |
| 4   | The command bus rejects unknown commands and invalid payloads with structured `CommandError`s. | `test_invalid_payload_returns_invalid_payload_error` + `test_channel_create_with_invalid_name_is_rejected`. |
| 5   | Agent writes into a `agent-messages-require-approval` channel become staged proposals.         | `test_agent_propose_message_creates_pending_proposal` green.                                                |
| 6   | A 50 000-event log replays in < 5 s on a developer laptop.                                     | `make replay-perf` (TODO: scripted bench).                                                                  |
| 7   | Sync cursors round-trip; bad cursors fall back to `sequence=0` without throwing.               | `test_sync_cursor.py` green.                                                                                |
| 8   | A file uploaded to MinIO can be downloaded via a presigned GET.                                | Manual smoke (TODO: integration test once `infra/docker-compose.yml` is available in CI).                   |
| 9   | `make replay` zeroes projections and rebuilds them bit-for-bit identically.                    | TODO once Alembic migrations are in.                                                                        |

Items 6/8/9 carry over into Phase 2 since they need the live stack;
items 1-5/7 are unblocked today.
