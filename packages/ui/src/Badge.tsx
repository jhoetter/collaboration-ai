import * as React from "react";
import { cn } from "./cn";

type Tone = "neutral" | "agent" | "info" | "success" | "warning" | "error";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-hover text-secondary",
  agent: "bg-[var(--agent-amber-light,#FEF3E6)] text-[var(--agent-amber,#D97706)]",
  info: "bg-[var(--accent-light)] text-[var(--accent)]",
  success: "bg-[#E6F4EE] text-[var(--success,#2F7D59)]",
  warning: "bg-[#FCEBD7] text-[var(--warning,#E57A2E)]",
  error: "bg-[#FBEAE8] text-[var(--error,#D84B3E)]",
};

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
}

export function Badge({ tone = "neutral", className, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase",
        TONE_CLASS[tone],
        className
      )}
      {...rest}
    />
  );
}
