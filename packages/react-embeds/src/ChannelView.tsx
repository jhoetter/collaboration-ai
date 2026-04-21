import * as React from "react";
import { ChannelIcon, cn } from "@collabai/ui";
import type { ChannelViewProps } from "./contract";

/**
 * Read-only or read-write history of a channel — used by hosts that just
 * need a "what's been said in #foo" surface (e.g. an FRU detail page in
 * hof-os linking the channel where the work was discussed).
 */
export function ChannelView({ channel, readOnly, className }: ChannelViewProps) {
  return (
    <section
      className={cn(
        "flex h-full flex-col overflow-hidden rounded-lg border border-divider bg-background text-foreground",
        className
      )}
    >
      <header className="flex items-center gap-2 border-b border-divider bg-surface px-3 py-2 text-sm font-medium">
        <ChannelIcon kind="public" />
        {channel}
        {readOnly ? <span className="text-[11px] text-tertiary">(read only)</span> : null}
      </header>
      <div className="flex-1 px-3 py-4 text-sm text-secondary">
        Channel history renders here once Phase 2 sync is online.
      </div>
    </section>
  );
}
