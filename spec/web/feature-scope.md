# Phase 5 — Web UI: Scope

## Goal

A modern, three-pane chat client built on Vite + React + TypeScript,
the `@collabai/ui` design system, and the `/api/sync` + `/ws/events`
endpoints from Phase 2. Visually parallel to office-ai's UI but
chat-shaped.

## In scope

- Vite + React 18 + TypeScript app under `packages/web`.
- Three-pane layout: workspace switcher (left), channel list (center
  left), message stream (center right), thread/details rail
  (collapsible right).
- Lexical-based composer with mentions autocomplete, slash commands,
  scheduled-send modal.
- Command palette (⌘K) wired to the agent API: search, jump to
  channel, run any function, approve a proposal.
- Agent inbox: a dedicated view of pending proposals + recent
  audit-log entries.
- Auth flows: password + TOTP; WebAuthn enrollment; OIDC SSO.
- Workspace admin: members, channels, agent identities, staging
  policies.
- Playwright tests covering: send/receive, mention, thread reply,
  approve a proposal, search.
- Visual regression harness via `@playwright/test`'s screenshot
  comparison.

## Out of scope

- Desktop / mobile native apps.
- Inline rich previews of arbitrary URLs (link unfurling is a Phase
  6 enhancement).
