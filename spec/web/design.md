# Phase 5 — Web UI: Design

## Build

- Vite + React 18 + TypeScript.
- Tailwind preset: `@collabai/design-tokens/tailwind-preset`.
- Component library: `@collabai/ui` (Avatar, Button, ChannelIcon, …).
- Routing: `react-router` v7.
- State: a tiny custom store under `src/state/` plus React Query for
  server reads.
- Editor: `@lexical/react`.

## Routes

| route                                        | view                        |
| -------------------------------------------- | --------------------------- |
| `/`                                          | redirects to most recent ws |
| `/w/:workspaceId`                            | default channel landing     |
| `/w/:workspaceId/c/:channelId`               | channel view                |
| `/w/:workspaceId/c/:channelId/t/:threadRoot` | thread overlay              |
| `/w/:workspaceId/dms/:dmId`                  | DM view                     |
| `/w/:workspaceId/agent`                      | agent inbox                 |
| `/w/:workspaceId/admin`                      | workspace admin             |
| `/auth/login`                                | password + TOTP             |
| `/auth/webauthn/register`                    | WebAuthn enrollment         |
| `/auth/oidc/callback`                        | OIDC return URL             |

## Layout

```
+--------+--------------+--------------------+----------+
| WS     | Channels     | Messages           | Thread   |
| switch | + DMs        |                    | / agent  |
|        |              | composer           | rail     |
+--------+--------------+--------------------+----------+
```

The right rail is reused for: thread, agent proposal detail,
workspace member info card, channel info, and the command palette
results popover.

## Sync wiring

- On mount, the workspace shell opens a WebSocket to `/ws/events`
  (with a long-poll fallback to `/api/sync`).
- The store applies incoming events through a small TypeScript port
  of the projector — same shape as the Python `ProjectedState`, scoped
  to the views the UI mounts (channels, messages-in-current-channel,
  unread, presence).
- Composer sends are optimistic: the local message appears
  immediately with a `pending` flag, then reconciles when the
  matching `message.send` event arrives.

## Auth

- `/auth/login`: email + password against
  `auth:login`. On success the server returns a session cookie + a
  CSRF token.
- TOTP: when the user has it enrolled, login is a 2-step page.
- WebAuthn: enrollment via `@simplewebauthn/browser`; assertion
  challenges on subsequent logins.
- OIDC: server-driven; the UI just bounces the user through the
  IdP and returns to `/auth/oidc/callback`.

## Playwright tests

- `e2e/send.spec.ts`: send + receive on two browsers.
- `e2e/mention.spec.ts`: @-mention triggers a notification badge.
- `e2e/thread.spec.ts`: open thread + reply.
- `e2e/proposal.spec.ts`: approve a staged proposal.
- `e2e/search.spec.ts`: ⌘K search.
- `e2e/visual.spec.ts`: full-page screenshot diff for the channel
  view + agent inbox.
