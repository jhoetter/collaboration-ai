import * as React from "react";
import { cn } from "./cn";

export interface AvatarProps {
  /**
   * Display name. Used for both the alt text on `imageUrl` and the
   * fallback initials.
   */
  name: string;
  imageUrl?: string | null;
  /** "human" agents render with the neutral surface; bots get the agent-amber halo. */
  kind?: "human" | "agent" | "system";
  size?: 16 | 20 | 24 | 28 | 32 | 40;
  className?: string;
}

const SIZE_CLASS: Record<NonNullable<AvatarProps["size"]>, string> = {
  16: "h-4 w-4 text-[8px]",
  20: "h-5 w-5 text-[9px]",
  24: "h-6 w-6 text-[10px]",
  28: "h-7 w-7 text-[10px]",
  32: "h-8 w-8 text-[11px]",
  40: "h-10 w-10 text-xs",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({ name, imageUrl, kind = "human", size = 24, className }: AvatarProps) {
  const ring = kind === "agent" ? "ring-1 ring-agent-amber/60" : "";
  return (
    <span
      className={cn(
        "inline-flex select-none items-center justify-center overflow-hidden rounded-full bg-hover font-medium text-foreground",
        SIZE_CLASS[size],
        ring,
        className
      )}
      title={name}
    >
      {imageUrl ? (
        <img src={imageUrl} alt={name} className="h-full w-full object-cover" />
      ) : (
        <span aria-hidden="true">{initials(name)}</span>
      )}
    </span>
  );
}
