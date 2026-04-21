# hof-os integration

How hof-os consumes [collaboration-ai](https://github.com/jhoetter/collaboration-ai)
to give every data-app workspace AI-native team chat (sidebar
embed, agent inbox, MCP-driven automation), driven entirely off
`infra/collabai.lock.json`. The shape of this integration mirrors
[`docs/officeai-integration.md`](../../hof-os/docs/officeai-integration.md)
on purpose — same release pipeline, same lockfile-as-contract, same
postinstall extraction, same sibling-checkout fallback for local
development.

## Three artefacts, one lockfile

Every push to `collaboration-ai/main` produces a single GitHub Release
with three artefacts:

- `collabai-app-X.Y.Z.tar` — Docker image tarball for the FastAPI +
  hof-engine backend (Postgres + Redis are provided by the host
  compose stack, like every other hof-engine app).
- `collabai-agent-X.Y.Z.tgz` — Node CLI + MCP server (`@collabai/agent-cli`)
  used by AI agents inside the sandbox container. Speaks JSON-RPC
  over stdio for MCP and HTTP against the FastAPI backend for
  command-bus dispatch.
- `collabai-react-embeds-X.Y.Z.tgz` — Browser React package
  (`@collabai/react-embeds`) exporting `<ChatPanel/>`, `<ChannelView/>`
  and `<AgentInbox/>` for the data-app sidebar.

The release also opens a PR against this repo bumping
`infra/collabai.lock.json` — all three pins in one commit:

```json
{
  "version": "X.Y.Z",
  "app_image": "ghcr.io/jhoetter/collaboration-ai:X.Y.Z",
  "app_image_tarball": "https://github.com/jhoetter/collaboration-ai/releases/download/vX.Y.Z/collabai-app-X.Y.Z.tar",
  "agent_version": "X.Y.Z",
  "agent_tarball": "https://github.com/jhoetter/collaboration-ai/releases/download/vX.Y.Z/collabai-agent-X.Y.Z.tgz",
  "react_embeds_version": "X.Y.Z",
  "react_embeds_tarball": "https://github.com/jhoetter/collaboration-ai/releases/download/vX.Y.Z/collabai-react-embeds-X.Y.Z.tgz",
  "published_at": "…",
  "source_repo": "jhoetter/collaboration-ai",
  "source_sha": "…"
}
```

The PR-bot is the same one that ships office-ai bumps, just keyed on
a different release-event filter. A human approves and merges; CI on
hof-os then rebuilds the data-app + sandbox images in the usual way.

## Backend — sidecar container

`infra/docker/Dockerfile.collabai-app` reads `app_image_tarball` (or
`app_image` for registries that allow direct pulls) and brings up the
collabai backend as a sidecar in the host compose stack. It mounts
the existing Postgres and Redis services, with a dedicated database
(`collabai_<tenant>`) per tenant.

Health-checks: the sidecar exposes `/healthz` (process up) and
`/readyz` (DB migrated, Redis reachable, command bus draining). The
data-app waits on `/readyz` before mounting the chat sidebar so the
UI never flashes a spinner against a half-booted backend.

## Backend — sandbox CLI

`infra/docker/Dockerfile.collabai-sandbox` reads `agent_version` and
`curl`s `collabai-agent-X.Y.Z.tgz` into `/opt/collabai-agent/`. A
small wrapper at `/usr/local/bin/collab` runs
`node /opt/collabai-agent/dist/cli.js "$@"` so agent-side Python can:

```python
subprocess.run(["collab", "send", "--channel", "general", "Hi team"])
subprocess.run(["collab", "mcp", "serve"])  # stdio MCP for the model loop
```

The deployer (`backend/app/services/deployer/compose.py`) inlines the
same Dockerfile when shipping to remote hosts so no build context is
streamed over SSH (matches `hof-skill-base` and the existing
office-ai sandbox).

## Frontend — embedded React surfaces

`packages/hof-components/data-app/ui/scripts/ensure-collabai-react-embeds.cjs`
runs as a `postinstall` step. It:

1. Reads `infra/collabai.lock.json` for `react_embeds_tarball` +
   `react_embeds_version`.
2. Downloads the tarball with redirect-following `https.get` (no
   external dependencies, no `npm` round-trip). Identical script to
   `ensure-officeai-react-editors.cjs` save for path constants.
3. Extracts it into
   `packages/hof-components/data-app/ui/node_modules/@collabai/react-embeds/`
   so Vite can `import` from it as if it were any other npm dep.
4. Stamps `.collabai-react-embeds.version` so subsequent
   `npm install` runs short-circuit when the version hasn't moved.

Same sibling-checkout fallback as office-ai: if the lockfile is
missing the new fields and a `collaboration-ai` checkout is present
next to `hof-os`, it runs
`pnpm --filter @collabai/react-embeds --prod deploy` against the
sibling and stamps the version as `sibling@<version>`.

If neither is available the script soft-fails (exit 0, warning
printed) and the chat sidebar hides itself
(`ChatSidebar` lazy-imports the package and renders `null` when the
import rejects). The rest of the data-app keeps working unchanged.

## Data-app UI surface

Two integration points today:

### 1. Chat sidebar (every workspace)

`packages/hof-components/data-app/ui/components/ChatSidebar.tsx`
mounts `<ChatPanel workspaceId={workspace.id} authToken={…}/>`
in the right rail next to the Assistent panel. The panel handles
its own routing (channel list, channel view, threads) inside a
single iframe-less React tree so the host shell stays in charge of
chrome.

The panel uses the host's React Query client (passed in via context)
so its background refetches share the same window-focus / network
listeners as the rest of the data-app.

### 2. Agent inbox (admin route)

`packages/hof-components/data-app/ui/pages/agent-inbox.tsx` mounts
`<AgentInbox workspaceId={…}/>` as a full-viewport route. Workspace
admins approve / reject staged agent commands here. A small badge
in the header shows the pending count, fetched via
`get_pending_agent_proposals_count` once on mount and on focus.

## Python `@function` shells

`packages/hof-components/starters/hofos/domain/collaborationai/` mirrors
the `officeai/` directory structure so the integration is discoverable
in the same place operators look for office-ai.

```
starters/hofos/domain/collaborationai/
  __init__.py
  client.py             # thin httpx wrapper around the sidecar's @functions
  agent_hooks.py        # allowlist + prompt hints for agent tools
  functions.py          # `@function` shells that proxy to the sidecar
  workflow_hooks.py     # send-on-event helpers usable from hof-engine flows
```

The shells expose collaboration-ai operations as native hof-engine
`@function`s — same pattern as office-ai's
`upload_workspace_file_to_s3`. Three are exposed by default:

- `collab_send_message(channel, content, *, mention_users=None)` —
  posts as the calling tenant's bot identity. Used by data-app flows
  to drop notifications into the right channel ("ETL run finished",
  "Approval requested for X").
- `collab_open_thread(channel, root_message_id)` — surfaces a
  thread-link an agent can paste back to the user.
- `collab_request_agent_approval(channel, command_type, payload,
  *, agent_id, ttl_minutes=60)` — stages a command via the agent
  API; humans approve/reject it via the web UI or `<AgentInbox/>`.

## CLI surface

`backend/app/cli/collabai.py` registers a `hofos collab` Typer group:

```sh
hofos collab status                       # sidecar health + lockfile pin
hofos collab bump                         # fetch latest release, write lockfile
hofos collab agent stage <command-json>   # stage an agent action from the CLI
hofos collab agent approve <proposal-id>  # approve a staged action
```

Output uses the existing Rich-based renderer the rest of `hofos`
uses, so log rotation, JSON output mode (`--json`), and the global
`--workspace` flag all keep working.

## Updating the pin manually

Normally the collaboration-ai release workflow opens the lockfile-bump
PR. Manual override (matches the office-ai flow):

```sh
$EDITOR infra/collabai.lock.json   # bump react_embeds_version + URL
cd packages/hof-components/data-app/ui
rm -f node_modules/@collabai/react-embeds/.collabai-react-embeds.version
npm run postinstall
```

The sandbox image picks up `agent_version` on the next deploy /
`make build-collabai-sandbox`. The sidecar image picks up `app_image`
on the next compose restart.
