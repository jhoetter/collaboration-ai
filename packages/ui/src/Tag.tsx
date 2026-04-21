import * as React from "react";
import { cn } from "./cn";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional accent — default is the neutral hover surface. */
  accent?: "neutral" | "teal" | "amber";
}

const ACCENT: Record<NonNullable<TagProps["accent"]>, string> = {
  neutral: "bg-hover text-secondary border-divider",
  teal: "bg-[var(--collab-teal-light,#E6F4F2)] text-[var(--collab-teal,#0E8A7E)] border-[var(--collab-teal-muted,#0E8A7E33)]",
  amber:
    "bg-[var(--agent-amber-light,#FEF3E6)] text-[var(--agent-amber,#D97706)] border-[var(--agent-amber-muted,#D9770633)]",
};

export function Tag({ accent = "neutral", className, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] font-medium",
        ACCENT[accent],
        className
      )}
      {...rest}
    />
  );
}
