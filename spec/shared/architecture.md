# Architecture

## Mission

`collaboration-ai` is a **Slack-class team collaboration product** with AI
agents as first-class participants. Same surface as Slack (workspaces,
channels, threads, DMs, reactions, files, search, presence) but the
event model, command bus, and agent API are designed up front so that
agents can read, propose, edit, and (with policy) post on the same
substrate humans use.

## Stack-level decisions

`prompt.md` calls for a TypeScript backend (Fastify + Kysely + BullMQ).
We deviate: the backend is a [`hof-engine`](https://github.com/jhoetter/hof-engine)
Python application. Rationale:

- `hof-engine` already provides Tables, `@function`, Flows, Cron, Celery
  fan-out, FastAPI, WebSockets, an admin UI, and an LLM-integration
  surface — the same primitives we'd otherwise rebuild in Node.
- Integration into `hof-os` is a solved problem when the upstream is
  itself a `hof-engine` app: it ships as a sibling Docker image plus an
  artifact tarball that drops into the hof-os sandbox, mirroring the
  `office-ai` pattern documented in `hof-os/docs/officeai-integration.md`.
- The behavioural contracts in `prompt.md` (event sourcing, /sync
  semantics, command bus, MCP, staging, audit) are language-agnostic and
  carried through unchanged.

TypeScript still owns the **web UI** (`app/ui/`), the **embeddable
React surfaces** (`packages/react-embeds`), and the design tokens.

## Component map

```
                   ┌────────────────────┐
                   │  collab-agent CLI  │  Python Typer + Rich
                   │  (Phase 4)         │  (also packaged as a self-contained
                   └─────────┬──────────┘   tarball for the hof-os sandbox)
                             │
                   ┌─────────▼──────────┐
                   │  HTTP / WS surface │  FastAPI: /api/functions/*, /api/sync,
                   │  (FastAPI)         │           /ws/events, /api/auth/*
                   └─────────┬──────────┘
                             │
                   ┌─────────▼──────────┐
                   │   Command bus      │  validate → authorise → handler →
                   │  (in-process)      │  envelopes → committer → projector
                   └─────────┬──────────┘
                             │
            ┌────────────────┼────────────────┐
            │                │                │
   ┌────────▼──────┐ ┌───────▼────────┐ ┌─────▼───────┐
   │  events Table │ │ Postgres       │ │  Redis      │
   │  (append-only,│ │ projections    │ │  pub/sub +  │
   │   partitioned)│ │ (channels,     │ │  presence + │
   └────────┬──────┘ │  messages,     │ │  rate buckets│
            │        │  reactions, …) │ └─────────────┘
            │        └───────┬────────┘
            │                │
   ┌────────▼────────────────▼────────┐
   │  Celery workers (projector,      │  Triggered on every commit;
   │  fan-out, scheduled, reminders,  │  also drives nightly digests
   │  retention, search index)        │  and presence GC.
   └──────────────────────────────────┘
```

## Source-of-truth split

| Where             | Truth                                       |
| ----------------- | ------------------------------------------- |
| `events` table    | The log. Append-only. Replay rebuilds all.  |
| Projection tables | Read-side caches; **derivable**, not truth. |
| Redis             | Ephemeral only — presence, rate buckets, fan-out queues. Never persisted. |
| MinIO / S3        | Attachment bytes (and thumbnails).          |

A `make replay` script wipes projections and rebuilds them from `events`
to prove this property in CI.

## Multi-tenancy

- Every event carries `workspace_id`. Every Postgres index begins with
  it. Every `@function` enforces it on the auth boundary.
- The `events` Table is partitioned by `(workspace_id, month)` so a
  workspace can be exported, archived, or deleted in one DROP TABLE.
- A "tenant per cell" deployment in `hof-os` runs one
  `collabai-app` container per workspace.

## Failure modes / non-negotiable bars

Per `prompt.md`:

- **Event-sourcing integrity**: replay determinism, edit-of-edit causal
  ordering, redaction with descendants, simultaneous reactions,
  idempotent retry. Suite under `tests/integration/events/` is
  merge-blocking from Phase 1.
- **Multi-device coherence**: scripted multi-client harness with a
  network split + reconnect, runs against the dockerised stack in CI.
  Suite under `tests/integration/sync/` is merge-blocking from Phase 2.
