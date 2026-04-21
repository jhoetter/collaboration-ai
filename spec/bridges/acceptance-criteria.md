# Bridges — Acceptance Criteria

Each item is an executable check. Phase 6 is "done" when all pass.

1. Slack export parser produces deterministic, ordered `BridgeEvent`s
   for a fixture export, including thread relationships and edits.
2. Importing the same Slack export twice creates the channels and
   messages exactly once (idempotent on export hash).
3. Slack-imported messages render in the web UI under
   `slack-archive/...` channels with the original sender's display
   name and an unmistakable "imported" badge.
4. Matrix poller persists and resumes from `next_batch`; restarting
   the worker mid-poll does not duplicate or skip events.
5. Both bridges fail closed when the workspace has not opted in
   (`policy.is_bridge_enabled` returns false).
6. Bridge writes appear in `agent_api.audit` with
   `agent_id="bridge:slack"` / `"bridge:matrix"` so admins can audit
   them like any other automated actor.
7. Cancelling a Slack import flow leaves the workspace in a
   consistent state — no partial channels in `import_status="active"`.
8. Re-running tests produces no flakes; bridge logic is fully
   deterministic given inputs and the workspace projection.
