import * as React from "react";
import { cn } from "./cn";

export type PresenceStatus = "online" | "idle" | "dnd" | "offline";

const TONE: Record<PresenceStatus, string> = {
  online: "bg-presence-online",
  idle: "bg-presence-idle",
  dnd: "bg-presence-dnd",
  offline: "bg-presence-offline",
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
