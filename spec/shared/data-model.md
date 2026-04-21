# Data model

Everything in Postgres is either:

- the **events** table (the truth), or
- a **projection** (a derived read-side cache).

Projections are rebuilt by `make replay` and CI verifies replay is
deterministic. Projection schemas can change without a data migration:
truncate, redeploy, replay.

## events

```sql
CREATE TABLE events (
  workspace_id   text       NOT NULL,
  sequence       bigint     NOT NULL,
  event_id       text       NOT NULL,
  type           text       NOT NULL,
  content        jsonb      NOT NULL,
  room_id        text       NOT NULL,
  sender_id      text       NOT NULL,
  sender_type    text       NOT NULL CHECK (sender_type IN ('human','agent','system')),
  agent_id       text,
  origin_ts      bigint     NOT NULL,
  relates_to_id  text,
  relates_to_rel text,
  idempotency_key text,
  origin         jsonb,
  PRIMARY KEY (workspace_id, sequence)
) PARTITION BY RANGE (workspace_id, origin_ts);

CREATE UNIQUE INDEX events_event_id_uniq ON events (workspace_id, event_id);
CREATE UNIQUE INDEX events_idempotency_uniq
  ON events (workspace_id, sender_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX events_room_seq ON events (workspace_id, room_id, sequence);
CREATE INDEX events_relates_to ON events (workspace_id, relates_to_id) WHERE relates_to_id IS NOT NULL;
```

Per-workspace monthly partitions are created on the fly by the
`workspace.create` projector (one per workspace, then one per month
rolling forward).

## Projection tables (sketch)

| Table                | Key                                              | Purpose                                                                     |
| -------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| `workspaces`         | `workspace_id`                                   | Display name, slug, icon, retention policy                                  |
| `workspace_members`  | `(workspace_id, user_id)`                        | Role, joined_at, invited_by                                                 |
| `channels`           | `channel_id`                                     | Name, type, topic, staging_policy, slow_mode_seconds, archived              |
| `channel_members`    | `(channel_id, user_id)`                          | Joined_at, role                                                             |
| `messages`           | `event_id`                                       | Sender, content (markdown), thread_root, edited_at, redacted, sequence      |
| `message_search`     | `(workspace_id, channel_id, event_id)`           | tsvector GIN — content + author + channel name                              |
| `reactions`          | `(message_id, emoji, user_id)`                   | One row per reactor                                                         |
| `read_markers`       | `(user_id, channel_id)`                          | up_to_sequence                                                              |
| `pinned`             | `(channel_id, message_id)`                       | Pinned messages                                                             |
| `drafts`             | `(user_id, channel_id)`                          | Server-side drafts (cross-device)                                           |
| `user_status`        | `user_id`                                        | Custom status (emoji + text + clear_at)                                     |
| `agents`             | `agent_id`                                       | Display name, scopes, registered_by                                         |
| `proposals`          | `proposal_id`                                    | Pending agent suggestions awaiting approval                                 |
| `attachments`        | `file_id`                                        | Object key, mime, size, thumbnail_key, virus_scan_status                    |
| `notifications`      | `(workspace_id, user_id, sequence)`              | Per-user inbox; consumed by web push / email digest                         |

Every projection is rebuildable by running its dispatch function from
`app/domain/events/projector.py` over the events log.

## Search

`message_search` is populated by a Postgres trigger on the `messages`
projection. The tsvector is built from `content || sender_name ||
channel_name` with the per-workspace text-search configuration (default
`simple` to keep multilingual content searchable; opt into `english`,
`german`, etc. per channel for stemming).

## Attachments

Object key shape: `workspaces/{workspace_id}/attachments/{file_id}`. We
**never** sign with global creds; presigned PUT/GET URLs are minted
inside `attachment:upload-init` / `attachment:download-url` `@function`
endpoints, scoped to the file the caller is authorised for.

Thumbnails (raster + small PDF preview) are generated lazily by a
Celery worker and stored under
`workspaces/{workspace_id}/attachments/{file_id}/thumb`.
