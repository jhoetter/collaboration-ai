import * as React from "react";
import { cn } from "./cn";

export type ColorSchemeValue = "light" | "dark" | "system";

export interface ThemeToggleProps {
  /** Current intent ("light" | "dark" | "system"). */
  value: ColorSchemeValue;
  onChange(next: ColorSchemeValue): void;
  className?: string;
  /** Compact (single-button cycler) for cramped toolbars. */
  compact?: boolean;
  /** Accessible label for screen readers. */
  label?: string;
}

interface Option {
  readonly value: ColorSchemeValue;
  readonly label: string;
  readonly title: string;
  readonly icon: React.ReactNode;
}

const SunIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2" />
    <path d="M12 20v2" />
    <path d="m4.93 4.93 1.41 1.41" />
    <path d="m17.66 17.66 1.41 1.41" />
    <path d="M2 12h2" />
    <path d="M20 12h2" />
    <path d="m6.34 17.66-1.41 1.41" />
    <path d="m19.07 4.93-1.41 1.41" />
  </svg>
);
const MonitorIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <rect width="20" height="14" x="2" y="3" rx="2" />
    <line x1="8" x2="16" y1="21" y2="21" />
    <line x1="12" x2="12" y1="17" y2="21" />
  </svg>
);
const MoonIcon = () => (
  <svg
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
  </svg>
);

const OPTIONS: ReadonlyArray<Option> = [
  { value: "light", label: "Light", title: "Light", icon: <SunIcon /> },
  { value: "system", label: "System", title: "System", icon: <MonitorIcon /> },
  { value: "dark", label: "Dark", title: "Dark", icon: <MoonIcon /> },
];

/**
 * 3-way segmented control over Light · System · Dark. Renderless of
 * its own state — pass the current value + setter so it can be wired
 * to whatever theme provider the host app uses (we use
 * `useColorScheme()` from `lib/theme/`).
 */
export function ThemeToggle({ value, onChange, className, compact, label = "Theme" }: ThemeToggleProps) {
  if (compact) {
    const idx = OPTIONS.findIndex((o) => o.value === value);
    const current = OPTIONS[idx >= 0 ? idx : 1];
    const next = OPTIONS[(OPTIONS.indexOf(current) + 1) % OPTIONS.length];
    return (
      <button
        type="button"
        onClick={() => onChange(next.value)}
        className={cn(
          "flex h-7 w-7 items-center justify-center rounded-md text-secondary transition-colors duration-150",
          "hover:bg-hover hover:text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
          className
        )}
        title={`${label}: ${current.title} → ${next.title}`}
        aria-label={`${label} (currently ${current.title})`}
      >
        {current.icon}
      </button>
    );
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-md bg-hover p-0.5", className)}
    >
      {OPTIONS.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={active}
            title={opt.title}
            className={cn(
              "flex h-6 items-center justify-center rounded px-2 transition-colors duration-150",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40",
              active ? "bg-background text-foreground shadow-sm" : "text-secondary hover:text-foreground"
            )}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}
