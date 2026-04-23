/**
 * Embed contract — props every host (e.g. hof-os data-app) passes when
 * mounting a collaboration-ai surface inline.
 *
 * Mirrors the office-ai `EmbeddedEditorProps` shape so the same wiring
 * (`presenceUser` from useOptionalAuth, `room` derived from a stable key)
 * carries over.
 */

export interface EmbedIdentity {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
  /** Hex colour for the cursor / typing indicator. */
  color?: string;
}

export interface EmbedConnection {
  /**
   * Base URL of the collaboration-ai backend. Defaults to
   * `globalThis.__COLLABAI_API_URL__` when omitted.
   */
  apiUrl?: string;
  /**
   * Service or session token that scopes the host into a workspace. The
   * embed never persists this; it is passed in on every mount.
   */
  token: string;
}

export interface EmbedCommonProps {
  workspaceId: string;
  identity?: EmbedIdentity;
  connection: EmbedConnection;
  /** Optional class name applied to the root element. */
  className?: string;
}

export interface ChatPanelProps extends EmbedCommonProps {
  /** Channel slug or id. */
  channel: string;
  /** Optional thread root event id. */
  thread?: string | null;
}

export interface ChannelViewProps extends EmbedCommonProps {
  channel: string;
  /** When true, the composer is hidden and only history is rendered. */
  readOnly?: boolean;
}

export interface AgentInboxProps extends EmbedCommonProps {
  /** Filter by channel; omit for "all channels in the workspace". */
  channel?: string;
}

/**
 * Single entry in a host-driven command palette. The collab-ai embed
 * exposes its action surface as a list of these so the host (e.g. the
 * hof-os data-app) can interleave them with its own commands inside a
 * single palette UI instead of mounting collab-ai's chrome.
 *
 * Mirrors the shape office-ai uses for its `editorCommands(ctx)` so
 * the host can register both with the same dispatcher.
 */
export interface CommandPaletteItem {
  /** Stable identifier; used for "recent commands" persistence + dedup. */
  id: string;
  /** Section header label (e.g. "Collab", "Channels"). */
  group: string;
  /** Primary, human-readable label rendered as the palette row. */
  label: string;
  /** Secondary line under the label (description / context). */
  hint?: string;
  /** Optional keyboard shortcut hint (display only — host owns binding). */
  shortcut?: string;
  /** Invoked when the host activates the row. May be async. */
  perform(): void | Promise<void>;
  /**
   * Optional pre-computed match score; the host's palette is free to
   * combine this with its own fuzzy-match output.
   */
  score?: number;
}

/**
 * Context passed into {@link import("./commands").collabaiCommands} so
 * the returned items can navigate, open dialogs, etc. without dragging
 * in the full WorkspaceShell.
 */
export interface CollabAiCommandContext {
  /** Active workspace; commands scope themselves to it. */
  workspaceId: string;
  /**
   * Called when a command wants to navigate inside the embed. Path is
   * embed-relative (e.g. `/c/<channelId>`). The host translates this
   * into its own router push.
   */
  navigate?: (path: string) => void;
  /** Opens the host-supplied "create channel" affordance, if any. */
  openCreateChannel?: () => void;
  /** Opens the host-supplied "new direct message" affordance, if any. */
  openNewDm?: () => void;
}
