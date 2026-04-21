# Phase 5 — Web UI: Acceptance Criteria

1. `pnpm --filter @collabai/web dev` boots a Vite dev server on
   `http://localhost:5173` and hot-reloads on edit.
2. Login with username + password lands the user on the most-recent
   workspace's default channel.
3. Sending a message from one browser appears in a second browser
   within 200ms (over WebSocket).
4. `⌘K` opens a command palette that calls the agent API for any
   `@function` typed in.
5. The agent inbox lists pending proposals with one-click approve /
   reject, audit-trail visible alongside.
6. Playwright e2e suite passes against the docker-compose stack
   (`make e2e`).
7. Visual regression baseline images live under
   `packages/web/tests/__visuals__/` and `pnpm test:visual` reports
   no diffs greater than 0.5%.
