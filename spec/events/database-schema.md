# Phase 1 — Database schema

Authoritative DDL. All tables live in the `collabai` schema.

## Truth

```sql
CREATE TABLE workspace_sequence (
  workspace_id text PRIMARY KEY,
  seq          bigint NOT NULL DEFAULT 0
);

CREATE TABLE events (
  workspace_id     text   NOT NULL,
  sequence         bigint NOT NULL,
  event_id         text   NOT NULL,
  type             text   NOT NULL,
  content          jsonb  NOT NULL,
  room_id          text   NOT NULL,
  sender_id        text   NOT NULL,
  sender_type      text   NOT NULL CHECK (sender_type IN ('human','agent','system')),
  agent_id         text,
  origin_ts        bigint NOT NULL,
  relates_to_id    text,
  relates_to_rel   text   CHECK (relates_to_rel IN ('m.replace','m.reaction','m.thread','m.redact')),
  idempotency_key  text,
  origin           jsonb,
  PRIMARY KEY (workspace_id, sequence)
) PARTITION BY LIST (workspace_id);

CREATE UNIQUE INDEX events_event_id_uniq
  ON events (workspace_id, event_id);
CREATE UNIQUE INDEX events_idempotency_uniq
  ON events (workspace_id, sender_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX events_room_seq
  ON events (workspace_id, room_id, sequence);
CREATE INDEX events_relates_to
  ON events (workspace_id, relates_to_id)
  WHERE relates_to_id IS NOT NULL;
```

## Projections

```sql
CREATE TABLE workspaces (
  workspace_id text PRIMARY KEY,
  name         text NOT NULL,
  slug         text UNIQUE,
  icon         text,
  created_at   bigint NOT NULL,
  created_by   text   NOT NULL
);

CREATE TABLE workspace_members (
  workspace_id text NOT NULL,
  user_id      text NOT NULL,
  role         text NOT NULL CHECK (role IN ('owner','admin','member','guest')),
  joined_at    bigint NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE channels (
  channel_id        text PRIMARY KEY,
  workspace_id      text NOT NULL,
  name              text NOT NULL,
  type              text NOT NULL CHECK (type IN ('public','private','dm','group_dm')),
  private           boolean NOT NULL DEFAULT false,
  topic             text,
  description       text,
  staging_policy    text NOT NULL DEFAULT 'agent-messages-require-approval',
  slow_mode_seconds integer NOT NULL DEFAULT 0,
  archived          boolean NOT NULL DEFAULT false,
  created_at        bigint NOT NULL,
  created_by        text   NOT NULL
);
CREATE INDEX channels_workspace ON channels (workspace_id);

CREATE TABLE channel_members (
  channel_id text NOT NULL,
  user_id    text NOT NULL,
  joined_at  bigint NOT NULL,
  role       text DEFAULT 'member',
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE messages (
  message_id   text PRIMARY KEY,            -- == event_id of the message.send event
  workspace_id text NOT NULL,
  channel_id   text NOT NULL,
  thread_root  text,
  sender_id    text NOT NULL,
  sender_type  text NOT NULL,
  agent_id     text,
  content      text NOT NULL DEFAULT '',
  mentions     text[] NOT NULL DEFAULT '{}',
  attachments  jsonb  NOT NULL DEFAULT '[]'::jsonb,
  edited_at    bigint,
  redacted     boolean NOT NULL DEFAULT false,
  redact_reason text,
  sequence     bigint  NOT NULL,
  created_at   bigint  NOT NULL,
  imported_from text,
  original_author text
);
CREATE INDEX messages_channel_seq ON messages (channel_id, sequence DESC);
CREATE INDEX messages_thread     ON messages (thread_root) WHERE thread_root IS NOT NULL;

CREATE TABLE message_search (
  message_id   text PRIMARY KEY REFERENCES messages(message_id) ON DELETE CASCADE,
  workspace_id text NOT NULL,
  channel_id   text NOT NULL,
  tsv          tsvector NOT NULL
);
CREATE INDEX message_search_tsv_idx ON message_search USING GIN (tsv);

CREATE TABLE reactions (
  message_id text NOT NULL,
  emoji      text NOT NULL,
  user_id    text NOT NULL,
  added_at   bigint NOT NULL,
  PRIMARY KEY (message_id, emoji, user_id)
);

CREATE TABLE read_markers (
  user_id          text NOT NULL,
  channel_id       text NOT NULL,
  up_to_sequence   bigint NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE pinned (
  channel_id text NOT NULL,
  message_id text NOT NULL,
  pinned_at  bigint NOT NULL,
  pinned_by  text   NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE drafts (
  user_id     text NOT NULL,
  channel_id  text NOT NULL,
  thread_root text,
  content     text NOT NULL,
  updated_at  bigint NOT NULL,
  PRIMARY KEY (user_id, channel_id)
);

CREATE TABLE attachments (
  file_id          text PRIMARY KEY,
  workspace_id     text NOT NULL,
  uploaded_by      text NOT NULL,
  object_key       text NOT NULL,
  mime             text NOT NULL,
  size_bytes       bigint NOT NULL,
  width            integer,
  height           integer,
  thumbnail_key    text,
  virus_scan_status text NOT NULL DEFAULT 'pending'
                       CHECK (virus_scan_status IN ('pending','clean','infected','error')),
  created_at       bigint NOT NULL
);

CREATE TABLE proposals (
  proposal_id   text PRIMARY KEY,            -- == content.proposal_id of agent.proposal.create
  workspace_id  text NOT NULL,
  channel_id    text NOT NULL,
  agent_id      text,
  command_type  text NOT NULL,
  payload       jsonb NOT NULL,
  rationale     text,
  status        text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','rejected','edited')),
  created_at    bigint NOT NULL,
  resolved_at   bigint,
  resolved_by   text,
  reject_reason text,
  edited_payload jsonb
);
CREATE INDEX proposals_pending ON proposals (workspace_id, channel_id) WHERE status = 'pending';

CREATE TABLE agents (
  agent_id      text PRIMARY KEY,
  workspace_id  text NOT NULL,
  display_name  text NOT NULL,
  scopes        text[] NOT NULL DEFAULT '{}',
  registered_at bigint NOT NULL,
  registered_by text   NOT NULL
);
```

## Migrations

Schema changes live in `app/migrations/` (Alembic). The first migration
creates everything above. New event types do not require a migration —
the projector adds new keys to existing dictionaries; only new
projection tables do.
