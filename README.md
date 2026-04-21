# collaboration-ai

AI-native, event-sourced team chat. Full Slack-style surface (workspaces,
channels, threads, DMs, reactions, files, search, presence) with AI
agents as **first-class participants** instead of bolted-on bots.

This repo is built per the spec in [`prompt.md`](./prompt.md), adapted to
ship as a [`hof-engine`](https://github.com/jhoetter/hof-engine)
application so it can deploy standalone _and_ embed cleanly into
[`hof-os`](https://github.com/jhoetter/hof-os) the way `office-ai` does.

## Stack

| Layer        | Tech                                                                |
| ------------ | ------------------------------------------------------------------- |
| Backend      | Python 3.12 + FastAPI + SQLAlchemy 2.0 + Postgres 16 + Redis 7      |
| Framework    | `hof-engine` (Tables / `@function` / Flows / Cron, Celery, Vite UI) |
| Web UI       | Vite + React 19 + Tailwind v4 + Lexical + `@collabai/ui`            |
| Agent CLI    | Python Typer + Rich, mirroring the `hofos` CLI shape                |
| MCP          | Auto-generated from the `@function` registry                        |
| Real-time    | Redis pub/sub fan-out + FastAPI WebSockets                          |
| Storage      | S3-compatible (MinIO in dev) for attachments                        |

## Repo layout

```
collaboration-ai/
  app/                # hof-engine application
    domain/           # tables, @function endpoints, command bus, projector
    flows/            # async workflows: fan-out, scheduled-message firing
    cron/             # nightly digests, presence GC, search index reaper
    ui/               # Vite + React 19 web UI
    tests/            # pure-Python projection + command-bus tests
  packages/
    design-tokens/    # @collabai/design-tokens (cloned from office-ai)
    ui/               # @collabai/ui — shared React primitives
    react-embeds/     # @collabai/react-embeds — embeddable surfaces
  cli/
    collabai/         # Python Typer CLI: `collab-agent`
  spec/               # phase-by-phase specs (architecture / events / sync / chat / agent / web)
  fixtures/           # event log + sync + chat + agent fixtures
  infra/              # docker-compose dev stack, release Dockerfile
  docs/               # build log + integration guide for hof-os
```

## Quickstart

```bash
make install                    # install JS + Python deps
make dev-stack                  # start Postgres + Redis + MinIO + Mailhog
make dev                        # backend on :8200, web UI on :5173
make verify                     # the merge gate
```

## Phases

1. **Event model + storage** — append-only event log, deterministic projector, command bus, attachments, search.
2. **Sync engine + real-time** — `/api/sync` long-poll, `/ws/events` WebSocket, presence + typing in Redis.
3. **Chat features** — workspaces / channels / threads / DMs / reactions / files / search / unread / drafts / scheduled / reminders / roles.
4. **Agent API + CLI + MCP** — every command exposed via the agent API; staging proposals; per-channel policies; agent budgets.
5. **Web UI** — three-pane Notion-like surface, Lexical editor, command palette, agent inbox, auth.
6. **Optional bridges** — read-only Slack export import + Matrix client-server poll into archive channels.

See [`spec/shared/architecture.md`](spec/shared/architecture.md) for the full breakdown.

## Integration with hof-os

Per [`docs/integration-with-hof-os.md`](docs/integration-with-hof-os.md), each push to `main` produces:

- `collabai-app:X.Y.Z` Docker image (the deployable backend + UI bundle)
- `collabai-agent-X.Y.Z.tgz` self-contained Python+CLI bundle for the hof-os sandbox image
- `collabai-react-embeds-X.Y.Z.tgz` browser package with `<ChatPanel />`, `<ChannelView />`, `<AgentInbox />`
- A PR against `hof-os` updating `infra/collabai.lock.json`

This mirrors the `office-ai` integration pattern. See `hof-os/docs/officeai-integration.md` for the original blueprint.
