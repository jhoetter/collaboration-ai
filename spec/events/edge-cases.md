# Phase 1 — Edge cases

## Edit-of-edit

A `message.edit` `relates_to` the **original** `message.send`, not the
prior `message.edit`. Two edits in flight serialise on the
`workspace_sequence` row; the projector applies them in commit order
and the most recent edit wins.

`tests/integration/events/test_command_bus.py` covers this via the
send→edit→redact case.

## Redaction with descendants

A `message.redact` clears the message content **and** drops all
reactions/pins on it. Threads rooted at a redacted message keep their
descendants visible (the thread continues), but the root message
displays a "redacted" tombstone. See
[`projector._project_message_redact`](../../app/domain/events/projector.py).

## Simultaneous reactions

Two clients reacting with the same emoji at the same instant:

- The committer assigns sequences 12 and 13 (in some order).
- The projector adds both `(emoji, user_id)` pairs to the
  `reactions[message_id][emoji]` set.
- Identical user reacting twice with the same emoji is a no-op (the
  set membership doesn't change).

Test: `test_simultaneous_reactions_from_distinct_users_are_independent`.

## Idempotent retry

Client retries on a network blip with the same `idempotency_key`. The
committer detects the conflict and returns the original event. The
client's `CommandResult` is identical, so its UI state stays
consistent.

Test: `test_replaying_same_message_send_twice_is_no_op`.

## Out-of-order sync delivery

The sync engine guarantees in-order delivery within a workspace, but a
malicious / buggy client could feed events to the projector in shuffled
order. The projector sorts by `(workspace_id, sequence)` defensively.

Test: `test_projection_determinism_shuffled_order_within_workspace_yields_same_state`.

## Read marker regression

A laggy phone client posts `read.marker` with a smaller
`up_to_sequence` after a desktop already advanced. The projector keeps
the higher value.

Test: `test_read_markers_only_advance_forward`.

## Edit-after-redact

`message.edit` after `message.redact` is silently dropped (the message
is terminal). The edit event is still in the log (audit), but it
doesn't change projection state.

Test: `test_edit_after_redact_is_dropped`.
