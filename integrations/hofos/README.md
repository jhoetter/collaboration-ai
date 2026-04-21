# integrations/hofos

Drop-in artefacts that live here as the source of truth and are
copied into `jhoetter/hof-os` by the release workflow (see
`.github/workflows/release.yml`). Keeping them here lets us version
them alongside the API contract they bridge — when we change a
payload shape in `app/domain/messages/functions_phase3.py`, the
matching `functions.py` in this directory moves in the same PR.

| Path | Destination in hof-os |
|---|---|
| `Dockerfile.collabai-app` | `infra/docker/Dockerfile.collabai-app` |
| `Dockerfile.collabai-sandbox` | `infra/docker/Dockerfile.collabai-sandbox` |
| `ensure-collabai-react-embeds.cjs` | `packages/hof-components/data-app/ui/scripts/ensure-collabai-react-embeds.cjs` |
| `starters/collaborationai/` | `packages/hof-components/starters/hofos/domain/collaborationai/` |
| `cli/collabai.py` | `backend/app/cli/collabai.py` |
| `ui/ChatSidebar.tsx` | `packages/hof-components/data-app/ui/components/ChatSidebar.tsx` |

## Why a separate `integrations/` directory?

Three reasons:

1. **Locality with the API contract.** The Python `@function`
   shells in `starters/collaborationai/functions.py` call sidecar
   endpoints whose payload shapes live in this repo. A change to
   either side without the other is a bug; co-locating them makes
   the bug discoverable at PR-review time.
2. **Bootstrap-only delivery.** These files are only needed to
   *first install* the integration; after the lockfile-bump PR lands
   in hof-os, all subsequent updates flow via
   `infra/collabai.lock.json` plus the `postinstall` script. We
   don't want to keep hot-syncing them.
3. **Mirror office-ai.** office-ai ships its starter under
   `packages/integrations/hofos/` for exactly the same reason.
   Following the pattern keeps the cognitive load low.

## Sync script

The release workflow runs `scripts/sync-hofos.sh` to copy this tree
into a clone of hof-os and open a PR. See
`infra/release/open-hofos-pr.sh` for the lockfile bump (which is the
common-case PR; the `integrations/hofos/**` sync only fires on
*manual* dispatch with `sync_hofos: true`).
