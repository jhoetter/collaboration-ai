# Phase 3 — Chat Features: Scope

## Goal

Take the foundation built in Phases 1+2 (event log, projector, command
bus, sync) and ship a fully usable team-chat backend on top, ready for
the web UI in Phase 5 and the agent CLI in Phase 4.

## In scope

- **Workspaces** (already in Phase 1) — extended with workspace
  settings (icon, slug, default channels) and bulk member operations.
- **Channels** (already in Phase 1) — extended with archive/unarchive
  authorization, slow-mode, channel descriptions, channel-bot scopes.
- **Threads** — every message is potentially a thread root. Replies
  reference a `thread_root` and surface in both the channel feed (as a
  reply count badge) and a dedicated thread pane.
- **DMs** — 1:1 and group DMs implemented as a special channel type
  (`type="dm"`). The first `dm:open` command is idempotent on a sorted
  participant set, so opening "DM with Alice + Bob" twice returns the
  same room.
- **Reactions** (already in Phase 1).
- **Files / attachments** — message payloads carry attachment refs
  (uploaded out-of-band to S3-compatible storage); the projector
  exposes a per-channel "files" view.
- **Mentions** — `@user`, `@channel`, `@here`, `@agent`. Validated at
  send time. Drives unread + notifications.
- **Search** — projection-backed full-text search over message
  content + attachment filenames. Multilingual: tokens are normalised
  with NFKC + lowercase + Unicode word splitting; the production
  backend swaps in Postgres `tsvector` with the matching language
  configuration.
- **Unread** — derived from `read_markers` (per user × per channel)
  versus the channel's `last_message_sequence`.
- **Notifications** — emitted as `notification.create` events on
  mentions, DMs, thread-replies-to-my-message, and reminders. Have
  their own read marker so dismissing a notification doesn't mark the
  underlying message as read.
- **Drafts** (already in Phase 1) — server-persisted, multi-device.
- **Scheduled messages** — a future-dated send. Stored as a
  `message.scheduled.set` event; a Celery beat job drains due
  scheduled messages into real `chat:send-message` commands.
- **Reminders** — "remind me about this in N minutes". Same shape as
  scheduled messages; emits a `notification.create` at fire time.
- **Roles** — `owner`, `admin`, `member`, `guest`. Authorisation
  helpers in `domain/shared/handlers.py` enforce per-command role
  requirements.

## Out of scope (deferred)

- Voice / video calls.
- Message forwarding across workspaces.
- Encrypted DMs (E2EE) — tracked in the security spec for a future
  phase.
- Custom emoji uploads (the `emoji` field accepts arbitrary unicode +
  shortcodes, but the registry of custom shortcodes is a Phase 5 web
  concern).

## Validation corpus

- `tests/integration/chat/fixtures/realistic_corpus.py` builds a
  3-workspace, 12-channel, 200-message, 10-thread synthetic corpus.
- `test_realistic_corpus_projection.py` asserts the projection over
  the corpus matches a hand-computed expected snapshot.
- `test_search_multilingual.py` covers English, German, Japanese, and
  emoji content; asserts NFKC normalisation + tokenisation behave on
  each.
- `test_unread_after_burst.py` asserts unread counts converge after a
  send burst and a `chat:mark-read` command.
- `test_notifications_on_mention.py` asserts a `@mention` triggers a
  `notification.create` for every mentioned user (excluding the
  sender themselves).
- `test_threads_list_replies.py` asserts the thread pane query returns
  replies in causal + sequence order.
- `test_scheduled_due_drains_into_send.py` simulates the Celery beat
  job draining scheduled messages.
- `test_dm_open_idempotency.py` asserts `dm:open` on the same
  participant set returns the same room.
