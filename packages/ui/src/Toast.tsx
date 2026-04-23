import { X } from "lucide-react";
import * as React from "react";
import { cn } from "./cn";

export type ToastTone = "info" | "success" | "warning" | "danger";

export interface ToastProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  tone?: ToastTone;
  /** Optional CTA rendered to the right of the body. */
  action?: { label: string; onClick: () => void };
  onDismiss?: () => void;
}

const TONE_RING: Record<ToastTone, string> = {
  info: "ring-accent/30",
  success: "ring-success/40",
  warning: "ring-warning/40",
  danger: "ring-danger/40",
};

const TONE_DOT: Record<ToastTone, string> = {
  info: "bg-accent",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function Toast({ title, description, tone = "info", action, onDismiss }: ToastProps) {
  return (
    <div
      role="status"
      className={cn(
        "pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-3 rounded-md border border-border bg-card p-3 text-sm text-foreground shadow-xl ring-1",
        TONE_RING[tone]
      )}
    >
      <span
        aria-hidden="true"
        className={cn("mt-1.5 inline-block h-2 w-2 flex-none rounded-full", TONE_DOT[tone])}
      />
      <div className="min-w-0 flex-1">
        {title && <p className="truncate font-medium leading-tight">{title}</p>}
        {description && (
          <p className="mt-0.5 break-words text-xs leading-snug text-secondary">{description}</p>
        )}
      </div>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          {action.label}
        </button>
      )}
      {onDismiss && (
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="-m-1 shrink-0 rounded-md p-1 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <X size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

export interface ToastViewportProps {
  children?: React.ReactNode;
}

export function ToastViewport({ children }: ToastViewportProps) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex flex-col items-end gap-2">
      {children}
    </div>
  );
}
