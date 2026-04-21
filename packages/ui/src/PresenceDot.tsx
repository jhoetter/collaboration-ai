import * as React from "react";
import { cn } from "./cn";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

const TONE: Record<PresenceStatus, string> = {
  online: "bg-[var(--presence-online,#22A55B)]",
  idle: "bg-[var(--presence-idle,#E0A028)]",
  dnd: "bg-[var(--presence-dnd,#D84B3E)]",
  offline: "bg-[var(--presence-offline,#9B9A97)]",
};

export interface PresenceDotProps {
  status: PresenceStatus;
  className?: string;
}

export function PresenceDot({ status, className }: PresenceDotProps) {
  return (
    <span
      role="status"
      aria-label={`Presence: ${status}`}
      className={cn("inline-block h-2 w-2 rounded-full ring-2 ring-background", TONE[status], className)}
    />
  );
}
