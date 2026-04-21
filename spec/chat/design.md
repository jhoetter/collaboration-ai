# Phase 3 — Chat Features: Design

## Layering

```
+--------------------------------------------------------+
|  hof-engine @function endpoints (per entity)           |
|  - workspaces / channels / messages / threads / dms    |
|  - search / unread / notifications / drafts            |
|  - scheduled / reminders                               |
+--------------------------------------------------------+
|  Command bus (Phase 1)                                 |
|  - validates payload, authorises, builds envelopes,    |
|    delegates to committer                              |
+--------------------------------------------------------+
|  Projector (Phase 1, extended)                         |
|  - projects new event types into ProjectedState        |
+--------------------------------------------------------+
|  Event log (Phase 1)                                   |
+--------------------------------------------------------+
```

Phase 3 is purely additive: new event types, new projector functions,
new handlers, new query functions. The existing tests in
`tests/integration/events/` continue to hold.

## New event types

| type                               | content                                  |
| ---                                | ---                                      |
| `dm.create`                        | `participant_ids: list[str]`             |
| `message.scheduled.set`            | `target_room_id, payload, fire_at`       |
| `message.scheduled.cancel`         | `scheduled_id`                           |
| `message.reminder.set`             | `target_event_id, fire_at`               |
| `message.reminder.cancel`          | `reminder_id`                            |
| `notification.create`              | `target_event_id?, kind, body`           |
| `notification.read`                | `notification_id`                        |

## Threads

Threads are flat (no nesting > 1) for v1.
* A reply carries `content.thread_root = <root_event_id>`.
* The projector adds `messages[root_id]["thread_reply_count"]++` and
  `messages[root_id]["thread_last_reply_ts"] = e.origin_ts`.
* Query: `threads:list-replies(thread_root_id)` returns the full
  ordered list of replies from the projection.

## DMs

* `dm:open(participant_ids: list[str])` — sorts the participant set,
  hashes it (SHA-1, stable), and uses `dm_<hash[:12]>` as the
  channel id. The handler:
  1. Looks up the channel; if it exists, returns `(applied, [])`.
  2. Otherwise emits a `channel.create` (type=`dm`, private=true)
     followed by `channel.member.join` for each participant.
* The projector marks the channel `type="dm"` so the web UI can
  render it under "Direct messages" instead of "Channels".

## Mentions

* The `chat:send-message` payload accepts `mentions: list[str]` (user
  ids) plus optional `mentions_special: list[str]` (`@channel`,
  `@here`, `@agent_name`).
* The handler validates that every mentioned user_id is a workspace
  member; unknown ids cause `invalid_payload` rejection so the client
  cannot accidentally tag a stranger.
* On commit, the bus emits one `notification.create` envelope per
  mentioned user (excluding the sender). These notifications carry
  `kind="mention"`.

## Search

* In-memory backend (used by tests and the dev server) walks
  `state.messages.values()` and matches normalised tokens.
* Production backend uses Postgres with a per-language `tsvector`
  computed from `content` + attachment filenames; the projector
  invalidates the index entry on edit/redact.
* Query: `search:messages(workspace_id, query, channel_ids?, sender_id?,
  limit, language?)`.

## Unread

* Per channel: `unread = max(channel_last_seq - read_markers[user][ch], 0)`
  where `channel_last_seq` is computed at query time from
  `max(msg.sequence for msg in state.messages.values() if msg.channel_id == ch)`.
* Per workspace: sum of unread across visible channels.
* Mention count: number of unread messages where the user is in
  `msg.mentions`.

## Notifications

* `notification.create` is the single source of truth.
* The projector keeps `state.notifications[user_id][notification_id]`.
* `notifications:list(user_id, limit, since?)` returns the user's
  recent notifications.
* `notifications:mark-read(notification_id)` emits `notification.read`,
  which moves it to `read=true`.

## Scheduled messages + reminders

* `chat:schedule-message(payload, fire_at)` emits
  `message.scheduled.set` with a freshly minted `scheduled_id`.
* The projector keeps `state.scheduled_messages[scheduled_id]`.
* A Celery Beat job (`scheduled_drainer`) runs every 30s, finds due
  entries, and dispatches the original `chat:send-message` command on
  behalf of the user.
* On success it emits `message.scheduled.fired` (recorded as part of
  the originating commit's idempotency_key so a crashed drainer
  doesn't double-send).
* Reminders are the same shape but carry `target_event_id` and emit a
  `notification.create` instead of a `message.send`.

## Roles

* The role taxonomy is `owner | admin | member | guest`.
* `owner` and `admin` can manage members + channels; `member` is the
  default; `guest` can only read + send in channels they are
  explicitly invited to.
* Enforcement lives in `_require_role` already.
