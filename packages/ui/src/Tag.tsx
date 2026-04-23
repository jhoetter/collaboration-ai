import * as React from "react";
import { cn } from "./cn";

export interface TagProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Optional accent — default is the neutral hover surface. */
  accent?: "neutral" | "teal" | "amber";
}

const ACCENT: Record<NonNullable<TagProps["accent"]>, string> = {
  neutral: "bg-hover text-secondary border-border",
  teal: "bg-collab-teal-light text-collab-teal border-collab-teal-muted",
  amber: "bg-agent-amber-light text-agent-amber border-agent-amber-muted",
};

export function Tag({ accent = "neutral", className, ...rest }: TagProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        ACCENT[accent],
        className
      )}
      {...rest}
    />
  );
}
