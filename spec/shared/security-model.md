# Security model

## Identity

- Users authenticate with **password (Argon2id)** + **TOTP** + optional
  **WebAuthn** passkeys. OIDC SSO is supported per workspace.
- Sessions are HTTP-only, SameSite=Lax, sliding expiry, persisted in
  Postgres so revocation works across devices.
- Agents authenticate with **service tokens** scoped to one workspace
  and a set of scopes (e.g. `read:channel`, `propose:message`,
  `approve:proposal`). Scopes are checked at the command-bus
  authoriser, not in the HTTP layer, so the agent CLI and the MCP
  server share the same enforcement path.

## Per-channel policy

Authorisation is layered:

1. Workspace membership (gate for any channel access).
2. Channel membership (private channels reject non-members; public
   channels reject non-workspace-members).
3. Role check (admin-only commands like `workspace:set-role`).
4. Staging policy (per-channel; see `command-bus.md`).
5. Rate budget (per identity + command class; see `domain/shared/rate_limit.py`).

Each layer rejects with a structured `CommandError` so the UI can
explain *why* an action was blocked.

## Attachments

- Presigned PUT/GET URLs are minted by `@function` endpoints, not by
  handing out long-lived AWS credentials.
- All uploads are virus-scanned (clamav sidecar) before they appear in
  the channel; failures move the attachment to a quarantine bucket.
- File previews are HTML-sanitised server-side (`bleach`) before being
  embedded in the message stream.

## Audit + retention

- Every committed event is the audit trail. `events` is append-only.
- Retention policies are workspace-level: a Celery `cron` job moves
  events older than the policy to a cold storage partition (or deletes
  them, per policy). The projection is rebuilt on the live partitions.
- Redactions don't remove the event; they emit a `message.redact`
  event whose projection clears the content from the read-side. This
  preserves the audit trail (you can prove a message was redacted by
  whom and when) without leaking the original text.

## Bridges (Phase 6)

Imported messages carry `origin: {source: 'slack', author_label: '…'}`.
They cannot be edited from `collaboration-ai`; the only mutation is a
workspace-level "purge import" command that drops the partition.
