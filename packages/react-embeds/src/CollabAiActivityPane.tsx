/**
 * Headless activity-feed embed.
 *
 * Wraps the standalone agent-inbox surface
 * (`packages/web/src/pages/AgentInbox.tsx`) — the live "pending
 * proposals waiting for human approve / reject" list — so hosts can
 * mount it as a right-rail panel without dragging in the full
 * `WorkspaceShell`.
 *
 * Doesn't need a router; the inbox reads workspace identity from the
 * shared auth store and proposals from React-Query.
 */
import { AgentInbox } from "../../web/src/pages/AgentInbox.tsx";

export interface CollabAiActivityPaneProps {
  /** Optional class merged onto the pane's root for layout overrides. */
  className?: string;
}

export function CollabAiActivityPane(_props: CollabAiActivityPaneProps = {}) {
  return <AgentInbox />;
}
