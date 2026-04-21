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
