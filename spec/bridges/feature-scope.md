# Bridges — Feature Scope (Phase 6, optional)

## Goals

Make existing team history readable inside collaboration-ai without
becoming responsible for the lifecycle of those external systems.
Bridges are **read-only**, **opt-in per workspace**, and write into
**archive channels** that admins can prune at will. We never claim
parity with the source system; we claim "good enough to search and
quote."

## In scope

1. **Slack export import**
   - Operator uploads a Slack workspace export `.zip` via the admin UI
     (or `hofos collab bridges slack import` CLI).
   - We extract `channels.json`, `users.json`, and per-channel
     `*.json` files in chronological order.
   - Each Slack channel maps to a new collaboration-ai channel under a
     `slack-archive/` prefix; private channels and DMs map to
     private channels with the original member set.
   - Each Slack message becomes a `message.send` event with
     `sender_type="system"` and metadata identifying the original
     Slack user, channel, and timestamp. Threads, reactions, and
     edits are flattened into a deterministic order.
   - Idempotency: re-running the import for the same export hash is a
     no-op.

2. **Matrix client–server poll**
   - Operator configures an access token + homeserver URL + a list of
     room IDs in workspace settings (or
     `hofos collab bridges matrix configure`).
   - A scheduled hof-engine flow polls `/sync` every N seconds, writes
     new events into the corresponding archive channel, and persists
     the next-batch token.
   - Backfill is gated behind an explicit "import history" toggle to
     avoid surprising long-running imports on a tiny config change.

## Out of scope (Phase 6)

- Two-way sync (we do not write back into Slack or Matrix).
- Live message edits/redacts after import (the archive is a
  point-in-time snapshot for Slack, append-only for Matrix).
- File contents — Slack/Matrix file URLs are kept as references; the
  attachment store does not download them.
- Per-message reactions and rich formatting beyond plain text +
  mentions.
- Other providers (Discord, Teams, IRC, etc.).

## Non-functional

- Imports run as background hof-engine flows. The admin UI shows
  progress and final stats (channels created, messages imported,
  failures).
- Imports must be cancellable. A cancelled import leaves a consistent
  state (already-emitted events stay; partial channels are marked
  with `import_status="cancelled"`).
- Per-bridge isolation: a Matrix outage must not block Slack
  imports or vice versa.
- All bridge writes go through the same command bus and
  authorisation layer as human messages.
