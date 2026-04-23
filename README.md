# collaboration-ai

AI-native, event-sourced team chat. Full Slack-style surface (workspaces,
channels, threads, DMs, reactions, files, search, presence) with AI
agents as **first-class participants** instead of bolted-on bots.

> **No LLMs ship inside the product.** Every model — OpenAI, Anthropic,
> a local Ollama, anything — runs in a third-party process and drives
> the workspace through the [`collab-agent` CLI](#the-cli-is-the-ai-surface)
> (or its MCP bridge). The server has no `OPENAI_API_KEY`, no inference
> code, no prompt templates. The CLI is the AI surface.

This repo is built per the spec in [`prompt.md`](./prompt.md), adapted to
ship as a [`hof-engine`](https://github.com/jhoetter/hof-engine)
application so it can deploy standalone _and_ embed cleanly into
[`hof-os`](https://github.com/jhoetter/hof-os) the way `office-ai` does.

## Stack

| Layer     | Tech                                                                |
| --------- | ------------------------------------------------------------------- |
| Backend   | Python 3.12 + FastAPI + SQLAlchemy 2.0 + Postgres 16 + Redis 7      |
| Framework | `hof-engine` (Tables / `@function` / Flows / Cron, Celery, Vite UI) |
| Web UI    | Vite + React 19 + Tailwind v4 + Lexical + `@collabai/ui`            |
| Agent CLI | Python Typer + Rich, mirroring the `hofos` CLI shape                |
| MCP       | Auto-generated from the `@function` registry                        |
| Real-time | Redis pub/sub fan-out + FastAPI WebSockets                          |
| Storage   | S3-compatible (MinIO in dev) for attachments                        |

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
make dev                        # one command: infra + backend (:8300) + web UI (:3300)
open http://localhost:3300
make verify                     # the merge gate
```

`make dev` mirrors hof-os: it auto-runs `db-up` (Postgres + Redis +
MinIO + Mailhog via `infra/docker-compose.yml`), kills any stale
ports, then starts the backend and web halves side by side under
`concurrently`.

Granular targets when you want finer control:

```bash
make dev-api                    # FastAPI + Celery on :8300 (assumes db-up)
make dev-web                    # Vite + React on :3300
make db-up | db-down | db-reset # infra lifecycle (== hof-os naming)
make db-logs                    # tail container logs
```

### Port allocation across the local AI suite

| Port | Project          |
| ---- | ---------------- |
| 3000 | hof-os           |
| 3100 | office-ai        |
| 3200 | mail-ai (held)   |
| 3300 | collaboration-ai |

Backends mirror the same scheme one decade up: 8000 / 8100 / 8200 / 8300.
Override with `make dev WEB_PORT=4000 API_PORT=9000` when needed.

## The CLI is the AI surface

External agents (any LLM, any framework) drive the workspace through
[`@collabai/agent-cli`](packages/agent-cli) — a thin TypeScript wrapper
around the same `@function` registry the web UI uses. Every chat
mutation, read, and event subscription has a CLI verb.

```bash
# 1. Authenticate against your collab server
collab-agent login --url https://collab.example.com \
  --token $COLLABAI_TOKEN --workspace ws_demo --actor agt_my_bot

# 2. Listen for new events (JSONL on stdout — pipe into any agent loop)
collab-agent subscribe --since 0 | while read evt; do
  echo "$evt" | my-llm-agent --tool collab-agent
done

# 3. Read, search, react, send — all without any inference code in the server
collab-agent read --channel c_general --since 1234
collab-agent search "deploy script" --limit 10
collab-agent react evt_abc 👀
collab-agent send --channel c_general --content "I looked into it; PR #42."

# 4. Generic escape hatch — call any @function by name
collab-agent call channel:list-members --json '{"channel_id":"c_general"}'

# 5. MCP bridge — auto-discovers every @function for stdio MCP clients
collab-agent mcp serve
```

Staging policies (`agent-messages-require-approval` etc.) are enforced
on the bus, so even an over-eager agent's actions land in the human
inbox first when the channel is configured that way.

The hofos sidecar CLI (`integrations/hofos/cli/collabai.py`) is a
narrow wrapper used by hof-os deploys to bump versions and stage
proposals; the first-class surface is `collab-agent`.

## Demo script

After `make dev` has the stack running on `:3300`, the seed script
gives you a fully populated workspace so you can click through every
Slack-style feature in two minutes:

1. **Open** http://localhost:3300 — you join `Demo Workspace` as a
   fresh anonymous identity, with a second human (`Alex Rivera`) and
   a `System` user already present.
2. **Sidebar** — switch between `#general`, `#engineering`, and
   `#random`; note unread badges and the `Mentions` shortcut.
3. **`#general`** — the welcome message from Alex is **pinned** and
   already has a 👋 reaction. Hover the message → reply in thread,
   add another emoji, or `Edit` your own.
4. **`#engineering`** — open the seeded thread "Heads up team…" in the
   right rail. Type `@a` to mention Alex (the mention picker is local).
5. **Drag-and-drop** any image into the composer to upload an
   attachment; rich text supports `**bold**`, `*italic*`, `` `code` ``
   and `> quote`.
6. **`Cmd-K`** opens the spotlight palette. Tabs: Channels, People,
   Messages — Messages hits the backend full-text search.
7. **Click 🎧 Huddle** in any channel header. The bottom sheet opens a
   LiveKit room (the dev compose stack ships a `livekit-server` on
   `:7880`); a system message links the huddle in the channel so
   anyone can join.
8. **DMs** — `+` next to "Direct Messages" → pick Alex → start a
   private 1-1.
9. **User menu** (bottom-left) — set a status emoji, toggle presence,
   or "Sign out" to mint a fresh identity.

Re-running `make seed` is idempotent — the partner user, channels,
welcome message, reactions, pin, and seeded thread are all guarded by
stable idempotency keys.

## Phases

1. **Event model + storage** — append-only event log, deterministic projector, command bus, attachments, search.
2. **Sync engine + real-time** — `/api/sync` long-poll, `/ws/events` WebSocket, presence + typing in Redis.
3. **Chat features** — workspaces / channels / threads / DMs / reactions / files / search / unread / drafts / scheduled / reminders / roles.
4. **Agent API + CLI + MCP** — every command exposed via the agent API; staging proposals; per-channel policies; agent budgets.
5. **Web UI** — three-pane Notion-like surface, Lexical editor, command palette, agent inbox, auth.

See [`spec/shared/architecture.md`](spec/shared/architecture.md) for the full breakdown.

## Integration with hof-os

Per [`docs/integration-with-hof-os.md`](docs/integration-with-hof-os.md), each push to `main` produces:

- `collabai-app:X.Y.Z` Docker image (the deployable backend + UI bundle)
- `collabai-agent-X.Y.Z.tgz` self-contained Python+CLI bundle for the hof-os sandbox image
- `collabai-react-embeds-X.Y.Z.tgz` browser package with `<ChatPanel />`, `<ChannelView />`, `<AgentInbox />`
- A PR against `hof-os` updating `infra/collabai.lock.json`

This mirrors the `office-ai` integration pattern. See `hof-os/docs/officeai-integration.md` for the original blueprint.
