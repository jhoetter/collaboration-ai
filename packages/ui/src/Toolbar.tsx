import * as React from "react";
import { cn } from "./cn";

export interface ToolbarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Visual density: `compact` is used for inline message hover bars, `comfortable` for the composer top toolbar. */
  density?: "compact" | "comfortable";
  /** When `floating`, the toolbar paints its own background, border, and shadow (e.g. hover bars). */
  surface?: "inline" | "floating";
}

/**
 * A horizontal segmented row of icon buttons. Use with `ToolbarButton`,
 * `ToolbarDivider`, and `ToolbarSpacer` to build composer formatting bars
 * and message hover toolbars.
 */
export function Toolbar({
  className,
  density = "comfortable",
  surface = "inline",
  ...rest
}: ToolbarProps) {
  return (
    <div
      role="toolbar"
      className={cn(
        "flex items-center",
        density === "compact" ? "gap-0.5" : "gap-1",
        surface === "floating" &&
          "rounded-md border border-border bg-card px-1 py-0.5 shadow-lg",
        className,
      )}
      {...rest}
    />
  );
}

export interface ToolbarButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required tooltip + accessible name. */
  label: string;
  active?: boolean;
  /** Optional keyboard shortcut hint shown next to the tooltip. */
  shortcut?: string;
  /** Override icon size; defaults to 16. */
  iconSize?: number;
}

export const ToolbarButton = React.forwardRef<HTMLButtonElement, ToolbarButtonProps>(
  function ToolbarButton(
    { label, active, shortcut, className, iconSize: _iconSize, children, ...rest },
    ref,
  ) {
    const tooltip = shortcut ? `${label} (${shortcut})` : label;
    return (
      <button
        ref={ref}
        type="button"
        title={tooltip}
        aria-label={label}
        aria-pressed={active || undefined}
        className={cn(
          "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded text-tertiary transition-colors duration-150",
          "hover:bg-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          active && "bg-hover text-foreground",
          "disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent",
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);

export function ToolbarDivider() {
  return <div className="mx-1 h-4 w-px self-center bg-border" aria-hidden="true" />;
}

export function ToolbarSpacer() {
  return <div className="flex-1" aria-hidden="true" />;
}
