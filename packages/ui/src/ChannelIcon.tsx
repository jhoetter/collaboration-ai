import * as React from "react";
import { cn } from "./cn";

export type ChannelKind = "public" | "private" | "dm" | "group_dm";

export interface ChannelIconProps {
  kind: ChannelKind;
  className?: string;
}

export function ChannelIcon({ kind, className }: ChannelIconProps) {
  const symbol = kind === "public" ? "#" : kind === "private" ? "🔒" : kind === "dm" ? "@" : "👥";
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex h-4 w-4 items-center justify-center text-[12px] text-secondary", className)}
    >
      {symbol}
    </span>
  );
}
