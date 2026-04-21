import * as React from "react";
import { Badge, cn } from "@collabai/ui";
import type { AgentInboxProps } from "./contract";

/**
 * Embed-side `<AgentInbox />` — surfaces pending agent proposals waiting
 * for a human approve/edit/reject decision. Phase 4 plugs in the live
 * proposal stream; this component renders the empty state today so hosts
 * can validate placement.
 */
export function AgentInbox({ workspaceId, channel, className }: AgentInboxProps) {
  return (
    <aside
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-divider bg-background text-foreground",
        className
      )}
      aria-label="collaboration-ai agent inbox"
    >
      <header className="flex items-center justify-between border-b border-divider bg-surface px-3 py-2">
        <span className="text-sm font-semibold">Agent inbox</span>
        <Badge tone="agent">{channel ? `#${channel}` : workspaceId}</Badge>
      </header>
      <div className="flex flex-1 items-center justify-center px-3 py-6 text-center text-sm text-secondary">
        No pending proposals.
      </div>
    </aside>
  );
}
