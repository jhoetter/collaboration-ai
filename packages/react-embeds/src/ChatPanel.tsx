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
      <header className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-divider bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <ChannelIcon kind="public" />
          <span className="truncate text-sm font-semibold">{channel}</span>
          <span className="hidden truncate text-[11px] text-tertiary sm:inline">/ {workspaceId}</span>
        </div>
        {identity ? (
          <div className="flex flex-none items-center gap-2">
            <Avatar name={identity.name} imageUrl={identity.avatarUrl} size={20} />
            <Badge tone="info">embedded</Badge>
          </div>
        ) : (
          <Badge tone="warning">no identity</Badge>
        )}
      </header>
      <div className="flex min-w-0 flex-1 items-center justify-center bg-background px-4 py-6 text-center text-sm text-secondary sm:px-6 sm:py-8">
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
