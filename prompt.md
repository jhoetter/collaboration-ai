# Build an AI-Native Team Collaboration Platform (Chat + Agents)

## Mission

You are a senior software architect and engineer. You will autonomously build a browser-accessible, AI-native team collaboration platform — `collaboration-ai` — in one continuous session. The platform is a full team chat product (channels, threads, DMs, reactions, files, search, presence) designed from the ground up so that **AI agents are first-class participants**, not bots bolted on.

This is not a Slack/Teams overlay. It is a standalone product that a company adopts in place of Slack or Teams for internal communication. Users accept that their historical Slack/Teams messages stay there; they start fresh in `collaboration-ai` with the benefit of an AI-native experience and a server-side-readable model that makes agents genuinely useful.

Work in this exact sequence, without skipping ahead:

1. Spec Event Model + Storage → Build → Validate
2. Spec Sync Engine + Real-Time → Build → Validate
3. Spec Chat Features (channels, threads, DMs, reactions, files, presence) → Build → Validate
4. Spec Agent API + CLI → Build → Validate
5. Spec Web UI → Build → Validate
6. Spec Optional Bridges (Slack/Matrix, read-only first) → Build → Validate

Do not start a phase until the previous one is fully validated. Do not start building until the spec for that phase is complete.

---

## Non-Negotiable Quality Bar

**Event Sourcing Integrity.** Every change in the system — every message sent, edited, deleted; every reaction; every membership change; every channel rename — is an immutable event appended to a log. The current state of any room is a deterministic projection of its event history. Specifically:

- Given the same event log, every replay produces the same state
- Reordering events within a room with the same causal relationships produces the same final state
- No state is ever mutated in place; "edits" and "deletes" are new events referencing prior ones
- Given any event ID, we can reconstruct what the room looked like at that moment
- Audit, compliance, undo, and agent review all fall out of this property for free

**Multi-Device Coherence.** A single user using our product from desktop, mobile, and a server-side agent simultaneously must see a coherent, eventually-consistent view:

- A message sent from desktop appears on mobile and in the agent's event stream within seconds
- Read markers set from mobile update desktop's unread badges
- An edit made from one device is reflected everywhere
- Network interruptions and reconnects never duplicate or drop messages
- The "since" sync token model works: a client disconnected for hours rejoins and gets exactly the events it missed, no more, no less

These two bars together are the acceptance criterion that cannot be traded away. Everything else is scope.

---

## Legal Constraint (Clean-Room Approach)

You will analyze reference repositories and specifications to extract concepts, patterns, and architectural decisions. You will then build a fresh implementation from a specification you derive — not a fork, not a dependency, not a copy.

**Allowed:** Study public code, extract architecture concepts, describe behavior and algorithms at the conceptual level, implement independently from first principles + the Matrix / Zulip / Mattermost / Rocket.Chat public specs and documentation. You are also allowed to use open source libraries for building, e.g. MIT- or Apache-licensed libraries that are unproblematic to build on.

**Not allowed:** Copy code verbatim, lightly rename identifiers, use any AGPL-licensed component as a runtime dependency, import reference repos as packages. In particular: **Synapse is AGPL** — study only, zero code copying. **Rocket.Chat server is MIT but specific modules are under various licenses** — verify before borrowing ideas from specific modules.

**Runtime dependencies permitted** (MIT / Apache 2.0 / BSD only):

- PostgreSQL driver (`pg`, MIT) — primary database
- `kysely` or `drizzle-orm` (MIT) — typed SQL query builder
- Redis client (`ioredis`, MIT) — presence, ephemeral pub/sub, rate limiting
- `bullmq` (MIT) — background jobs (notifications, file processing, retention)
- `fastify` or `hono` (MIT) — HTTP server framework
- `ws` (MIT) — WebSocket server
- `zod` (MIT) — runtime schema validation
- `argon2` (MIT) — password hashing
- `@simplewebauthn/server` (MIT) — WebAuthn / passkeys
- S3-compatible client (e.g. `@aws-sdk/client-s3`, Apache 2.0) — file storage
- `sharp` (Apache 2.0) — image thumbnailing
- `dompurify` + `jsdom` (MIT) — HTML sanitization for rich text
- `lexical` or `prosemirror-*` (MIT) — rich text editing on the client
- `web-push` (MIT) — browser push notifications
- Any other MIT/Apache/BSD library if justified in the spec

**Explicitly forbidden as runtime dependencies:**

- Synapse (AGPL) — study spec + architecture only
- Anything from Rocket.Chat server code that's not under MIT — verify per-file
- FreeScout, Mastodon, or other AGPL groupware code — study only

---

## Reference Repositories and Specifications

Study these before speccing each phase. Read architecture docs, main source files, specs, and tests. Do not copy. Understand.

### Event Model + Room Semantics (the core design borrowings)

- **Matrix Client-Server spec** — https://spec.matrix.org/latest/client-server-api/ — canonical reference for event structure, room state, sync protocol, read markers, edits-as-events, redactions, reactions. Borrow concepts; do not implement the protocol itself.
- **Matrix Room Version 11 spec** — event authorization rules, state resolution; relevant even though we don't federate
- **Dendrite** (Apache 2.0, Go) — https://github.com/matrix-org/dendrite — reference for a cleaner Matrix homeserver implementation; read for architectural ideas only
- **Conduit / conduwuit** (Apache 2.0, Rust) — single-process Matrix homeservers; study how they handle storage

### Team Chat Product Architecture

- **Zulip** (Apache 2.0) — https://github.com/zulip/zulip — primary reference for threads-as-first-class, topic-based organization, async-friendly chat; study their message model, narrow-based views, and notification logic
- **Mattermost** (MIT + source-available split) — study the MIT-licensed parts; reference for WebSocket event design, channel/team hierarchy, REST API shape
- **Rocket.Chat** (MIT with exceptions) — architecture reference for multi-tenant, real-time, and integrations design

### Real-Time Sync

- **Matrix `/sync` endpoint** — long-poll with `since` tokens; study the request/response shape and how incremental sync works
- **CouchDB replication protocol** — elegant model for "give me everything since sequence N"
- **Phoenix Channels** (Elixir, MIT) — https://github.com/phoenixframework/phoenix — clean WebSocket channel abstraction; study the protocol even if we use Node.js

### E2EE (study only — out of scope for v1)

- **libsignal-protocol** — reference for Double Ratchet if we ever add E2EE
- **Olm / Megolm** specs — Matrix's E2EE approach
- **MLS (RFC 9420)** — future-proofing reference; the IETF Messaging Layer Security standard

### Agent Integration Patterns

- **Slack Events API + Socket Mode** — https://api.slack.com/apis/events-api — study how they expose events and actions to bots (we're building something similar but first-class)
- **Model Context Protocol (MCP)** — https://spec.modelcontextprotocol.io/ — emerging standard for AI-tool integration; design our agent API MCP-compatible from the start

### Format Standards (canonical truth, always prefer over implementations)

- IETF RFCs for content: RFC 5322 (text), RFC 7578 (multipart/form-data), CommonMark spec for markdown
- WebAuthn L2: https://www.w3.org/TR/webauthn-2/
- OAuth 2.1 + PKCE: draft-ietf-oauth-v2-1
- OpenID Connect Core 1.0
- WebSocket: RFC 6455

---

## Project Structure

Create this monorepo from the start:

```
/
  packages/
    core/               # shared types, event schema, command bus, plugin system
    events/             # event model, event log, projection engine, idempotency
    storage/            # database schema, migrations, repository pattern, object storage
    sync/               # /sync endpoint, WebSocket gateway, presence, typing, read markers
    chat/               # channels, threads, DMs, reactions, mentions, search, files
    identity/           # users, workspaces, orgs, auth (password, WebAuthn, OIDC/SSO), sessions
    permissions/        # role/ACL model, per-channel and per-workspace authorization
    notifications/      # email, web push, mobile push; per-user preferences
    agent/              # agent API (headless) + CLI tool (collab-agent) + MCP server
    bridges/            # optional read-only bridges (Slack, Matrix) — phase 6
    web/                # browser UI
    mobile/             # React Native shell (deferred; stub package)
    server/             # HTTP + WebSocket API server composition
  spec/                 # living specification
    shared/
    events/
    sync/
    chat/
    agent/
    web/
    bridges/
  fixtures/             # synthetic test data
    workspaces/         # seeded multi-user scenarios
    messages/           # edge-case message fixtures (markdown, code, emoji, attachments)
  tests/
    integration/        # multi-client coherence tests
    load/               # performance tests (large rooms, high event rates)
    agent/              # agent API + CLI tests
  infra/
    docker/             # dev stack: Postgres, Redis, MinIO (S3), mailhog
  docs/
    build-log/          # decisions, discoveries, deviations from spec
```

---

## Phase Structure (Repeat for Each Phase)

### Step A: Analyze

Before writing a single line of spec or code, deeply study the reference repos and specs for this phase. Specifically answer:

1. What's the canonical model? (For events: how does Matrix handle edits, redactions, reactions? For sync: how does Matrix's `/sync` work vs. Phoenix Channels vs. Zulip's event queue?)
2. How is state reconciled across multiple clients? What's the source of truth for each field?
3. What's the mutation pattern? How does a "send message" flow from UI → server → back to other connected clients?
4. How are hard parts handled? (Thread reply vs. channel message, edit-an-edit, deletion tombstones, reaction aggregation, presence accuracy at scale, typing indicators without flooding)
5. What does the reference get wrong or sacrifice that we should improve?
6. What's missing from the 80% scope we need?
7. What will an AI agent need from this that a human user doesn't?

Write analysis notes in `/spec/{phase}/analysis.md`. These notes inform the spec but are not the spec.

---

### Step B: Spec

Produce the specification for this phase. The spec is the contract for the build. It must be complete enough that someone could implement it independently.

**Required spec documents:**

#### `/spec/shared/` (produce once, before Phase 1)

- `architecture.md` — the overall system: processes, services, how they communicate; deployment model (self-hosted single-tenant, self-hosted multi-tenant, optional managed cloud)
- `event-model.md` — the event taxonomy: `message`, `message.edit`, `message.redact`, `reaction.add`, `reaction.remove`, `membership`, `channel.create`, `channel.archive`, `typing`, `read.marker`, etc.; required fields; ordering rules; idempotency keys; this is the most important spec doc
- `data-model.md` — projected state: workspace, channel, thread, message, user, membership, reaction, attachment, read-marker; how these relate to events
- `command-bus.md` — every state change (human click, agent call, system trigger) flows through a command; commands produce events; events update projections; commands are serializable JSON; results are diffable
- `plugin-system.md` — how features are registered; how a plugin declares what commands/events it handles; clean separation of core vs. features
- `security-model.md` — auth flows, session management, CSRF, token storage, rate limiting per user/agent, per-workspace isolation, per-channel ACLs, what an attacker who compromises one component can and cannot do; legal hold and compliance export
- `agent-api.md` — the unified agent API contract: what every agent needs; separation between read, propose (staged), and commit (applied); MCP compatibility

#### `/spec/{phase}/` (per phase)

- `feature-scope.md` — exactly what is IN the 80% and what is explicitly OUT; no ambiguity
- `design.md` — the design specific to this phase; data types, state machines, algorithms
- `wire-protocol.md` (sync phase) — exact JSON schemas for WebSocket frames and `/sync` responses; sequence tokens; reconnect semantics
- `database-schema.md` — exact tables, columns, indexes, foreign keys, constraints, migrations; partitioning strategy for messages
- `algorithms.md` — pseudocode for non-trivial logic (event fan-out, state projection, sync cursor computation, conflict handling for simultaneous edits)
- `api.md` — HTTP endpoints, WebSocket events, CLI commands exposed by this phase; full request/response schemas
- `edge-cases.md` — known hard cases and how we handle them; what we degrade gracefully; what surfaces as an error
- `acceptance-criteria.md` — measurable done criteria: which integration tests must pass, which manual flows must work, performance targets

**Spec quality bar:** A spec document is done when:

- It is self-contained (doesn't assume knowledge from the reference repos)
- It is precise (data types have explicit shapes, algorithms have pseudocode or step-by-step prose)
- It is honest (scope exclusions are explicit, uncertainties are flagged)
- It is actionable (someone could implement from it without asking clarifying questions)

Do NOT begin building until the spec passes this bar.

---

### Step C: Build

Implement the phase based on the spec. Follow this sub-order within each phase:

1. **Storage / protocol layer first** — event log, DB schema, or wire protocol before any higher-level logic; validate with integration tests immediately
2. **Pure domain logic** — state machines, projection engine, threading; pure TypeScript, no HTTP, no DOM, no React
3. **Command bus integration** — every mutation flows through the bus; headless-testable
4. **HTTP / WebSocket API** — expose functionality; test with integration tests using real WebSocket clients
5. **Agent API + CLI** — expose commands programmatically; test headlessly before any UI work
6. **UI layer** — only after the headless stack is green

**Build discipline:**

- Write integration tests before implementing each feature; use Postgres + Redis + MinIO in Docker for CI
- Every command must be testable headlessly (no browser required)
- Every PR-equivalent commit must not reduce multi-client coherence test pass rate
- Performance benchmarks tracked per phase; no silent regressions on sync latency or event fan-out throughput
- Keep `/docs/build-log/{phase}.md` updated with non-trivial decisions

---

### Step D: Validate

Before declaring a phase complete and moving to the next:

Run the full validation suite:

- [ ] Integration tests pass against Dockerized Postgres + Redis + MinIO
- [ ] Multi-client coherence tests pass: N simulated clients connected via WebSocket see the same projected state after a scripted sequence of events
- [ ] Event log integrity: replaying the log from scratch produces identical projections
- [ ] Agent API / CLI tests pass: all commands work headlessly, exit codes correct, JSON output validates against schema
- [ ] Performance: a workspace with 10k users, 1k channels, 1M historical messages syncs initial state in under target, live events fan out in under target latency
- [ ] Security: auth flows verified, session management correct, rate limiting enforced, per-channel ACLs verified with adversarial tests
- [ ] Spec and build log are up to date

Only after all boxes are checked: move to the next phase.

---

## The 80% Scope per Phase

### Phase 1: Event Model + Storage — In Scope

- **Event log**: append-only, per-room ordering, global monotonic sequence, idempotency via client-supplied `event_id`
- **Event types**: `message`, `message.edit`, `message.redact`, `reaction.add`, `reaction.remove`, `membership` (join/leave/kick/invite), `channel.create`, `channel.update`, `channel.archive`, `read.marker`, `typing` (ephemeral, not persisted), `presence` (ephemeral)
- **Projection engine**: deterministic function from event log → current state (messages, memberships, reactions, read markers per user)
- **Storage layout**: Postgres for events + projections; object storage (S3-compatible) for attachments; Redis for ephemeral state (presence, typing) and pub/sub fan-out
- **Schema**: events table partitioned by workspace + time; projection tables (messages, channels, memberships, reactions) as materialized views of the log
- **Attachments**: stream uploads directly to object storage; DB stores metadata only; pre-signed URLs for download with short TTL
- **Search**: Postgres `tsvector` full-text index on message content, updated via trigger on insert

### Phase 1: Event Model + Storage — Explicitly Out of Scope

- Sharding across multiple Postgres instances (design for it; single-instance for v1)
- Federation (not planned; do not design in hooks for it)
- End-to-end encryption (v1 is server-readable; explicitly documented)
- Cold-storage tiering for old messages (defer)

---

### Phase 2: Sync Engine + Real-Time — In Scope

- **HTTP `/sync` endpoint**: long-poll with `since` cursor; returns events since cursor + room state deltas; used by mobile and fallback clients
- **WebSocket gateway**: primary real-time channel; clients subscribe to workspaces they belong to; server pushes events per-room to connected subscribers
- **Sync cursor semantics**: strictly monotonic per workspace; clients persist the cursor; reconnecting with a stored cursor returns exactly the missed events
- **Initial sync**: on first connect, client requests recent window (last 50 messages per active channel, all memberships, channel list); historical messages lazy-loaded on scroll
- **Typing indicators**: ephemeral, fan out via Redis pub/sub, TTL ~5s, never persisted
- **Presence**: online/idle/offline per user; aggregated across devices; last-seen timestamp persisted; current status in Redis
- **Read markers**: per-user-per-channel; stored as events so they sync across devices
- **Fan-out**: on `message` event, compute recipient set (channel members with `read` permission), push via WebSocket to connected clients, enqueue push notifications for disconnected clients
- **Backpressure**: slow clients buffered up to N events, then force-resync with cursor mismatch
- **Rate limits**: per-user-per-second message limits; per-IP connection limits; per-agent command limits (separate budget)

### Phase 2: Sync Engine + Real-Time — Explicitly Out of Scope

- Peer-to-peer / WebRTC data channels (defer; not needed for text chat)
- Custom binary wire protocol (JSON over WebSocket is fine for v1)
- Mobile push at carrier level (defer native mobile to post-v1; web push only initially)

---

### Phase 3: Chat Features — In Scope

- **Workspaces**: top-level tenant; each user belongs to N workspaces; data isolation is strict
- **Channels**: public (anyone in workspace can join), private (invite-only), DM (1:1), group DM (3-8 people)
- **Threads**: every message can have replies; threads are first-class (Zulip-inspired), not hidden like early Slack; thread count and unread count per thread
- **Messages**: plaintext + CommonMark subset (bold, italic, code inline, code block, lists, links, blockquote); max length configurable; edit window configurable; soft-delete preserves audit trail
- **Mentions**: `@user`, `@channel`, `@here`; parsed server-side; trigger notifications per user preference
- **Reactions**: emoji reactions aggregated per-message; server stores individual reaction events, projection aggregates
- **Files/attachments**: images, PDFs, arbitrary files up to configurable size; inline image preview; thumbnail generation via `sharp` for images
- **Code snippets**: syntax-highlighted code blocks (server returns highlighted HTML; client renders directly); file-upload-as-snippet for long code
- **Search**: full-text across messages user has access to; filters by channel, user, date range, file-attached, thread
- **Unread tracking**: per-channel unread count, per-thread unread count, user's "priority inbox" view (mentions + DMs + watched threads)
- **Notifications**: web push for mentions/DMs by default; email digest for users idle for N hours; per-channel notification overrides
- **Drafts**: persisted server-side per channel/thread so drafts sync across devices
- **Scheduled messages**: send-later queued in BullMQ; visible to sender as pending
- **Reminders**: `/remind me in 2h to follow up` — persisted, delivered as DM from system
- **User status**: custom emoji + text; auto-clear after duration; snooze notifications for duration
- **Channel properties**: topic, description, pinned messages, channel-wide slow mode
- **Roles**: workspace owner, admin, member, guest (limited to specific channels)

### Phase 3: Chat Features — Explicitly Out of Scope

- Voice/video calls (integrate a third-party provider later; not core)
- Screen sharing (same)
- Huddles / ephemeral rooms (defer)
- Workflows / approval chains (defer; possible plugin territory)
- Canvas / collaborative docs inside chat (defer — but see integration point for collaboration-ai doc product)
- Slack Connect-style cross-workspace DMs (defer)

---

### Phase 4: Agent API + CLI — In Scope

- **Headless Agent API** (`@collab/agent`): connect via HTTP + WebSocket to the server with a service token; zero browser dependency
- **Every collaboration operation exposed as a typed command** — agents do exactly what humans can do, nothing more, nothing less (except clearly scoped agent-only powers like "propose a message for human approval")
- **CLI tool** (`collab-agent`): pipeable, scriptable, JSON output by default; device-flow auth for one-time human authorization of a long-running script
- **MCP server**: a built-in Model Context Protocol server so AI tools (Claude Desktop, Cursor, custom agents) can connect and use `collaboration-ai` as a tool without any custom integration code
- **Read operations**: list workspaces, channels, threads, messages; read users, memberships, reactions, files; search; get event log slice; subscribe to event stream
- **Write operations**: send message, edit message, delete message, react, unreact, mention, upload file, create channel, invite user, set topic, pin message, set status, set read marker, snooze
- **Staged mutations**: an agent can `propose` a message that appears as a pending draft in a dedicated UI region; a human approves (auto-edits allowed) before it's sent. Configurable per-channel: some channels auto-send agent messages (with badge), others require approval.
- **Agent identity**: agents appear in member lists with an "agent" badge; their messages are attributed; `created_by_agent` field on every event authored by an agent
- **Agent budgets**: per-agent rate limits (messages/min, tokens/day, API calls/min); enforced server-side; exceedance returns `429` with retry-after
- **Batch operations**: apply N commands atomically — transactional at the event-log level — with all-or-nothing semantics documented
- **Subscriptions**: long-running agents `subscribe` to event streams with filters (channel, event type, keyword match); server pushes matching events; `unsubscribe` cleans up

### Phase 4: Agent API + CLI — Explicitly Out of Scope

- Native SDKs in languages other than TypeScript (document the HTTP API; TS SDK only for v1)
- Agent-to-agent direct messaging without human oversight (agents communicate through channels only, observable to workspace admins)
- Plugin execution inside the server process (agents run in their own processes and talk to the server via API)

---

### Phase 5: Web UI — In Scope

- Channel list sidebar, thread panel on right, message composition at bottom — familiar three-pane layout
- Thread-first: every message has a "reply in thread" affordance; threads open in right panel without losing channel context
- Rich text editor (Lexical or ProseMirror) with markdown shortcuts, slash commands, @mentions, emoji picker, file drop
- Inline rendering: images, link previews, code highlighting, mention pills, emoji reactions with hover-to-see-reactors
- Search UI with filters (channel, user, date, has files, in thread)
- Command palette (`Cmd-K`): jump to channel, jump to user DM, search, invoke agent action
- Keyboard-first: Gmail/Slack-style shortcuts for everything; `?` shows the full list
- Agent drawer: for any channel, shows pending agent proposals; approve / edit / reject inline
- MCP settings: workspace admin can enable/disable agent capabilities, view agent audit logs
- Notification settings: per-channel overrides, Do Not Disturb schedule, email digest preferences
- Account connection: password + TOTP 2FA, WebAuthn passkeys, optional OIDC SSO for workspace-wide enforcement
- Workspace admin UI: members, channels, roles, audit log, retention settings, agent capabilities, retention export

### Phase 5: Web UI — Explicitly Out of Scope

- Native mobile apps (responsive web only for v1; React Native stub package exists but isn't built out)
- Offline mode with service worker message caching (defer)
- Customizable themes beyond light/dark (defer)
- Plugin marketplace (defer)

---

### Phase 6 (Optional): Read-Only Bridges — In Scope

This phase exists so users can _see_ their historical Slack or Matrix context inside `collaboration-ai` during migration, without us taking on the full overlay burden.

- **Slack import**: one-time export ingestion from Slack's native export format (JSON zip); messages land in read-only archive channels, clearly marked as imported; search includes them
- **Matrix bridge**: read-only — our server connects to a user's Matrix homeserver via client-server API, mirrors selected rooms as read-only archive channels; we do not send messages back
- **Attribution**: imported messages clearly show origin, original timestamp, original author; never attributed as native
- Bridges are opt-in per workspace and disabled by default

### Phase 6 — Explicitly Out of Scope

- Bidirectional Slack/Teams bridge (explicitly NOT in scope — out of clean-room / API-terms reasons AND because Slack explicitly restricts third-party bulk API access; a bidirectional bridge is a different product)
- Teams import (Microsoft's export format is not well-documented; defer)
- Live sync of Slack messages (no — import is one-shot)

---

## The AI-Native Design (Most Important Section)

This is the core differentiator. The platform must be designed from the ground up so that AI agents are first-class participants — not bots bolted on top, not commands you slash-invoke, but peers that read context, propose actions, and learn from approvals.

### Core Principle: Everything Is an Event

No direct mutation is ever allowed. Every change — whether made by a human typing in the UI, or by an AI agent calling an API, or by a system trigger (scheduled message firing, retention policy deleting) — produces an **event** that's appended to the log. This is not optional architecture; it is the invariant that makes everything else (audit, undo, agent review, multi-device sync, compliance export) possible.

An event is:

```typescript
interface Event<T extends string, C> {
  event_id: string; // UUID, client-generatable for idempotency
  type: T; // e.g. "message.send", "reaction.add", "channel.archive"
  content: C; // fully typed, serializable to JSON
  room_id: string; // workspace-scoped room identifier
  sender_id: string; // user or agent that authored the event
  sender_type: "human" | "agent" | "system";
  agent_id?: string; // which agent, if sender_type === 'agent'
  origin_ts: number; // millis; set by server; immutable
  sequence: bigint; // global monotonic, assigned by server on commit
  relates_to?: {
    // for edits, reactions, threads
    event_id: string;
    rel_type: "m.replace" | "m.reaction" | "m.thread" | "m.redact";
  };
  idempotency_key?: string; // prevents duplicate commits on retry
}
```

### The Command Bus

Events are the _effect_. Commands are the _intent_. A command is what a caller sends; it validates, authorizes, and produces one or more events:

```typescript
interface Command<T extends string, P> {
  type: T; // e.g. "chat:send-message", "chat:edit-message"
  payload: P;
  source: "human" | "agent" | "system";
  actor_id: string;
  session_id: string;
  idempotency_key?: string;
}

interface CommandResult {
  command_id: string;
  status: "applied" | "staged" | "rejected" | "failed";
  events: Event[]; // zero or more events produced
  error?: { code: string; message: string };
}
```

Staged commands (see below) produce a `staged` result; the events aren't committed to the log until approved.

### The Agent API

The headless agent interface:

```typescript
interface CollaborationAgent {
  // Identity + workspaces
  whoAmI(): Promise<AgentIdentity>;
  listWorkspaces(): Promise<Workspace[]>;

  // Read
  listChannels(workspaceId: string): Promise<Channel[]>;
  listMessages(query: MessageQuery): Promise<Message[]>; // by channel, thread, date range
  getMessage(messageId: string): Promise<Message>;
  getThread(rootMessageId: string): Promise<Thread>;
  listMembers(channelId: string): Promise<Member[]>;
  search(query: SearchSpec): Promise<SearchResult[]>;
  getEvents(query: EventQuery): Promise<Event[]>; // slice of event log; agent-only power

  // Write — everything goes through command bus
  applyCommand(command: Command): Promise<CommandResult>;
  applyCommands(commands: Command[]): Promise<CommandResult[]>; // atomic at event-log level

  // Staged (propose-and-approve)
  propose(command: Command): Promise<StagedProposal>;
  getPendingProposals(filter?: ProposalFilter): Promise<StagedProposal[]>;
  // Only humans can approve/reject; agents cannot self-approve
  // approveProposal() and rejectProposal() exist but return 403 for agent tokens

  // Subscriptions
  subscribe(filter: EventFilter, handler: EventHandler): Subscription;
  unsubscribe(subscriptionId: string): void;

  // MCP interop
  getMcpManifest(): Promise<McpManifest>; // exposes tool definitions for MCP clients
}
```

This interface must work **headlessly** — with zero DOM, zero browser, zero HTTP client in the UI sense. An AI agent running in Node.js on a server must be able to authenticate, read, write, subscribe, and propose.

The web UI is a user of the same agent API (with a `human` session token instead of an `agent` service token) — not a special path.

### Command Catalog (minimum set; expand fully in spec)

```
chat:send-message          { channel_id, content, thread_root?, mentions?, attachments? }
chat:edit-message          { message_id, new_content }
chat:delete-message        { message_id }
chat:add-reaction          { message_id, emoji }
chat:remove-reaction       { message_id, emoji }
chat:pin-message           { message_id }
chat:unpin-message         { message_id }
chat:mark-read             { channel_id, up_to_event_id }

channel:create             { workspace_id, name, type, private, topic? }
channel:update             { channel_id, changes }
channel:archive            { channel_id }
channel:join               { channel_id }
channel:leave              { channel_id }
channel:invite             { channel_id, user_ids }
channel:kick               { channel_id, user_id, reason? }

user:set-status            { emoji?, text?, clear_at? }
user:set-presence          { status: "active" | "away" | "dnd", until? }
user:snooze-notifications  { until }

workspace:invite           { workspace_id, email, role }
workspace:set-role         { workspace_id, user_id, role }

agent:propose-message      { channel_id, content, rationale? }
agent:subscribe-events     { filter }
agent:unsubscribe-events   { subscription_id }
```

### The Human Review Flow (Agent Staging)

When `source === 'agent'` AND the command type is flagged as "requires approval" in the target channel's policy, the command produces a **staged proposal** — not a committed event:

```
Channel State:
  ├── committed: Event[]             (authoritative log)
  ├── pending:   StagedProposal[]    (agent proposals awaiting human action)
  └── projected: ChannelProjection   (committed + pending = what UI shows with markers)
```

The UI renders `projected` with pending proposals visually marked (like a pull-request review). The human can:

- **Approve** → proposal's events commit to the log; they become real and fan out
- **Edit and approve** → human edits the text; the edit + approval is itself recorded in the audit log; committed message shows "edited by human before send"
- **Reject** → proposal is discarded; optional reason recorded in audit log
- **Bulk approve/reject** from a dedicated "agent inbox" UI

Policy is per-channel, configurable by channel admin. Possible policies:

- `all-require-approval` (default for sensitive channels)
- `agent-messages-require-approval` (mod messages and channel changes are auto)
- `auto-send-with-badge` (agent messages auto-send but clearly marked)
- `fully-autonomous` (agent has full human-equivalent power; not recommended for human-facing channels)

### MCP (Model Context Protocol) Integration

The agent API doubles as an MCP server. We expose the collaboration primitives as MCP tools so that any MCP-compatible client (Claude Desktop, Cursor, IDE plugins, custom agent frameworks) can connect to a workspace with a service token and immediately have:

- `list_channels`, `list_messages`, `search` — read tools
- `send_message`, `react`, `propose_message` — write tools (subject to staging policy)
- `subscribe_events` — streaming tool (MCP resources)

The MCP manifest is auto-generated from the Command Catalog. Zero custom integration code: drop in the service token, and the AI tool has immediate workspace access scoped to that token's permissions.

### The CLI Interface

Produce a CLI tool (`collab-agent`) that wraps the headless agent API. Pipeable, scriptable, JSON output by default.

```bash
# Authentication
collab-agent auth login                     # device flow; opens browser
collab-agent auth whoami
collab-agent auth logout
collab-agent auth token create --name "triage-bot" --scopes read,send,react

# Workspaces + channels
collab-agent workspace list
collab-agent channel list --workspace acme
collab-agent channel show general --format json
collab-agent channel create --name engineering --type public

# Reading
collab-agent message list --channel general --limit 50 --format json
collab-agent message show msg_abc --with-thread
collab-agent thread show msg_abc --format markdown
collab-agent search "deploy failing" --channel engineering --since 24h

# Writing
collab-agent message send --channel general --text "Morning all"
collab-agent message send --channel general --file ./reply.md
collab-agent message reply msg_abc --text "+1"
collab-agent message edit msg_abc --text "corrected"
collab-agent react msg_abc --emoji eyes

# Staging (agent proposes, human approves)
collab-agent propose send --channel support --text "$(cat draft.md)" --rationale "Triage bot suggests this reply"
collab-agent proposals list --format json
collab-agent proposals approve prop_xyz      # fails for agent tokens; returns 403

# Subscriptions (for long-running agents)
collab-agent watch --channel support --event message --exec './triage.sh {{event_json}}'
collab-agent watch --keyword "urgent" --notify webhook:https://my.service/alert

# MCP
collab-agent mcp serve                        # starts MCP server over stdio
collab-agent mcp manifest                     # prints MCP tool manifest

# Bulk / scripting
collab-agent message list --channel support --status unresolved --format json \
  | jq '.[] | select(.age_hours > 24)' \
  | xargs -I{} collab-agent react {}.id --emoji clock
```

JSON output is the default. `--format table` or `--format markdown` for human use. Exit codes: 0 success; 1 user error; 2 auth error; 3 network error; 4 conflict; 5 rate-limited. Errors go to stderr as structured JSON when `--format json` is set.

---

## Integration Requirements

### Auth (Inbound)

- Email + password with strong hashing (argon2id), mandatory 2FA for workspace admins
- WebAuthn / passkeys for password-less login
- OIDC / SAML SSO via generic OIDC provider support — not tied to any one IdP; customers can use Okta, Google Workspace, Azure AD, Keycloak
- Per-workspace enforced MFA / SSO policies
- Session management: server-side sessions with opaque tokens; revocable; device list visible to user
- API tokens (service tokens) for agents: scoped, rotatable, auditable

### External Service Tokens (Outbound, for integrations)

- **Email delivery**: SMTP or API (SendGrid, AWS SES) for digest emails, invites, alerts
- **Object storage**: S3-compatible (AWS S3, MinIO, Cloudflare R2) for attachments
- **Push notifications**: web push via VAPID; mobile push deferred
- **LLM providers** (optional, for built-in AI features): OpenAI, Anthropic — credentials configured per-workspace; messages sent to LLMs are scoped to the agent's permissions, fully audited

### API Shapes

```typescript
// HTTP API
POST   /api/commands                // body: Command | Command[]
GET    /api/workspaces
GET    /api/workspaces/:id/channels
GET    /api/channels/:id/messages?before=:eventId&limit=50
GET    /api/messages/:id
POST   /api/files                   // attachment upload, returns file_id + pre-signed URL
GET    /api/sync?since=:cursor      // long-poll sync fallback
WS     /api/events                  // primary real-time channel

// MCP
POST   /api/mcp                     // MCP JSON-RPC endpoint (when not using stdio)

// Headless agent (Node.js, same process or remote)
import { CollaborationAgent } from '@collab/agent'
const agent = await CollaborationAgent.connect({ apiUrl, token: process.env.COLLAB_TOKEN })
const channels = await agent.listChannels(workspaceId)
await agent.applyCommand({
  type: 'chat:send-message',
  payload: { channel_id: channels[0].id, content: 'Hello from an agent' },
  source: 'agent',
  actor_id: 'agent:digest-bot',
  session_id: 'sess_123',
})
```

---

## Fixture Corpus

Before building each phase, collect or generate test data. This is not optional.

### Event Log Fixtures (Phase 1)

- A recorded event stream of 50k events across 20 channels and 3 workspaces — used for projection correctness tests
- Pathological cases: edit-of-edit, redaction of a message with many replies, simultaneous reactions from many users, extremely long threads (500+ replies)
- Idempotency cases: same `event_id` submitted twice; commit once, return the original on retry

### Sync Fixtures (Phase 2)

- Scripted multi-client scenarios: 5 clients, 3 channels, simulated network splits, reconnects with stored cursors — used as integration tests
- Slow client scenario: one client 10k events behind; server correctly resyncs without dropping or duplicating
- Typing storm: 50 users typing at once; server rate-limits fan-out without dropping real messages

### Chat Feature Fixtures (Phase 3)

- Message corpus: 10k realistic messages covering markdown, code blocks, mentions, files, emoji, long threads
- A synthetic workspace with 200 users, 50 channels, 3 months of activity — used for performance benchmarks
- Search corpus: multi-language content (English, German, Japanese, Arabic) to verify tsvector configuration is right

### Agent + MCP Fixtures (Phase 4)

- Agent service-token scenarios: bounded read, bounded send, propose-only, full-agent
- MCP client fixtures: a minimal MCP client that connects, lists tools, invokes each, verifies responses
- Staging scenarios: agent proposes → human approves, agent proposes → human edits, agent proposes → human rejects; each produces correct audit trail

---

## Architecture Principles (Non-Negotiable)

1. **Event-sourced core.** The event log is the source of truth. All projections are derived. Any projection can be rebuilt from the log. This is what makes audit, undo, agent review, compliance export, and multi-device sync all fall out of the same primitive.

2. **Commands are the only mutation path.** Direct DB writes to projections are never allowed from application code. Events are the only way state changes. This is the invariant that enables everything above.

3. **Server-readable by default; E2EE deferred.** For an AI-native product, server-side access to message content is a feature — it's what makes agents useful. Customers who need E2EE will not be our v1 customers. We document this clearly. We design the event model so that adding E2EE later via MLS (RFC 9420) is possible, but do not implement it now.

4. **Headless-first.** The core of every module runs in Node.js with zero DOM. The web UI is just a rendering surface on top of the HTTP + WebSocket API. This is what makes the agent API real.

5. **Agents are first-class participants, not bolt-ons.** Agents appear in member lists, have identities, their messages are attributed, their actions are audited, their capabilities are scoped. An agent typing a message uses the same `chat:send-message` command a human does — with `source: 'agent'` and its own rate limit budget.

6. **MCP-native from day one.** The agent API is designed MCP-compatible. AI tools plug in with a service token. No custom integration.

7. **Multi-tenancy is a first-class concept.** Workspace isolation is enforced at the database layer (row-level security or schema-per-tenant — decide in spec). Cross-workspace data access is impossible by construction, not by convention.

8. **Progressive loading.** Large workspaces must not block initial sync. Load recent window first; historical messages lazy on scroll. The user can read, send, and collaborate before full historical load is done.

9. **Fail loudly.** Sync errors, command rejections, permission violations, rate-limit exceedances surface as structured errors with useful codes — never as silent drops or data corruption.

10. **No smuggling.** Agent capabilities are explicit and auditable. Agents cannot escalate privileges, cannot act on behalf of humans, cannot DM humans outside their authorized channels. Every agent action is attributable and revocable.

---

## Output at the End of Each Phase

When you complete a phase (Spec → Build → Validate), produce:

1. **`/spec/{phase}/`** — all spec documents, complete and up-to-date
2. **`/packages/{phase}/`** — the implementation
3. **`/tests/integration/{phase}/`** — passing integration test suite
4. **`/docs/build-log/{phase}.md`** — decisions, deviations from spec, known issues
5. **A summary comment** in the session describing: what was built, what passes, what's deferred, what was harder than expected

---

## Start Instructions

1. Read this entire prompt twice.
2. Set up the monorepo structure.
3. Set up the local dev stack (Docker Compose: Postgres, Redis, MinIO, Mailhog).
4. Generate the synthetic fixture corpus.
5. Begin the Event Model analysis phase — study Matrix's event model, Zulip's message model, Mattermost's WebSocket protocol.
6. Produce the shared spec (`/spec/shared/`) and the Phase 1 spec.
7. Build the event log + storage layer.
8. Validate against fixtures.
9. Move to Phase 2 (Sync Engine). Repeat.
10. Continue through Phases 3, 4, 5, and optionally 6 in order.

Before starting, confirm:

- You understand the clean-room constraint and will not copy code from Synapse or any AGPL source
- You understand the event-sourcing integrity bar and will not move forward without passing it
- You understand the multi-device coherence bar and will not move forward without passing it
- You understand the headless-first / agent-first / MCP-native design requirement
- You understand the phase sequence: each phase complete before the next starts
- You understand that E2EE is explicitly deferred and that the product is server-readable by design
- You understand that this is NOT a Slack/Teams overlay — it is a standalone product; bridges in Phase 6 are read-only imports only

Ask no clarifying questions. Begin.
