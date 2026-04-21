import * as React from "react";
import { Avatar, Badge, ChannelIcon, cn } from "@collabai/ui";
import type { ChatPanelProps } from "./contract";

/**
 * Embed-side `<ChatPanel />`. The full implementation is wired in Phase 5
 * once the agent API and sync engine are stable; this skeleton renders a
 * connection-status header and a placeholder body so host apps can mount
 * the component today and see the layout adopt host theme tokens.
 */
export function ChatPanel({ workspaceId, channel, identity, connection, className }: ChatPanelProps) {
  const apiUrl = connection.apiUrl ?? "";
  return (
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-divider bg-background text-foreground",
        className
      )}
      aria-label={`collaboration-ai chat panel for #${channel}`}
    >
      <header className="flex items-center justify-between gap-2 border-b border-divider bg-surface px-3 py-2">
        <div className="flex items-center gap-2">
          <ChannelIcon kind="public" />
          <span className="text-sm font-semibold">{channel}</span>
          <span className="text-[11px] text-tertiary">/ {workspaceId}</span>
        </div>
        {identity ? (
          <div className="flex items-center gap-2">
            <Avatar name={identity.name} imageUrl={identity.avatarUrl} size={20} />
            <Badge tone="info">embedded</Badge>
          </div>
        ) : (
          <Badge tone="warning">no identity</Badge>
        )}
      </header>
      <div className="flex flex-1 items-center justify-center bg-background px-6 py-8 text-center text-sm text-secondary">
        <div>
          <p>collaboration-ai chat panel</p>
          <p className="mt-1 text-tertiary text-xs">
            Phase 5 wires the live message stream against {apiUrl || "the configured API"}.
          </p>
        </div>
      </div>
    </section>
  );
}
