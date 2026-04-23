import * as React from "react";
import { cn } from "./cn";

type Tone = "neutral" | "agent" | "info" | "success" | "warning" | "error";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-hover text-secondary",
  agent: "bg-agent-amber-light text-agent-amber",
  info: "bg-accent-light text-accent",
  success: "bg-success-bg text-success",
  warning: "bg-warning-bg text-warning",
  error: "bg-destructive-bg text-destructive",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        TONE_CLASS[tone],
        className
      )}
      {...rest}
    />
  );
}
