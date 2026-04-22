import * as React from "react";
import { cn } from "./cn";

export interface ModalProps {
  /** Optional title rendered in the modal header. Omit to suppress the header entirely. */
  title?: React.ReactNode;
  /** Right-aligned content in the header, e.g. action buttons. */
  headerActions?: React.ReactNode;
  /** Called when the user clicks the scrim, presses Escape, or clicks the close button. */
  onClose: () => void;
  children: React.ReactNode;
  /** "md" (default) is good for forms; "sm" / "lg" for quick prompts and rich panels. */
  size?: "sm" | "md" | "lg";
  /** When `true`, hides the trailing close button in the header (useful when the modal manages its own actions). */
  hideCloseButton?: boolean;
  /** Additional classes applied to the inner card. */
  className?: string;
  /** Accessible label fallback when there's no `title`. */
  ariaLabel?: string;
}

const SIZE_CLASS: Record<NonNullable<ModalProps["size"]>, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-2xl",
};

/**
 * Centered modal dialog with a translucent scrim. Backdrop click and
 * the Escape key both fire `onClose`. The card uses semantic tokens so
 * it follows the active design-system + colour-scheme automatically.
 */
export function Modal({
  title,
  headerActions,
  onClose,
  children,
  size = "md",
  hideCloseButton,
  className,
  ariaLabel,
}: ModalProps) {
  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={typeof title === "string" ? title : ariaLabel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4 backdrop-blur-sm mobile-sheet:items-end mobile-sheet:p-0"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={cn(
          "flex w-full max-h-[85vh] flex-col overflow-hidden rounded-lg border border-border bg-card text-foreground shadow-2xl mobile-sheet:max-h-[92dvh] mobile-sheet:rounded-t-xl mobile-sheet:rounded-b-none",
          SIZE_CLASS[size],
          className,
        )}
      >
        {(title || !hideCloseButton || headerActions) && (
          <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
            <h2 className="truncate text-sm font-semibold text-foreground">{title}</h2>
            <div className="flex items-center gap-1">
              {headerActions}
              {!hideCloseButton && (
                <button
                  type="button"
                  aria-label="Close"
                  onClick={onClose}
                  className="rounded-md p-1 text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M18 6 6 18" />
                    <path d="m6 6 12 12" />
                  </svg>
                </button>
              )}
            </div>
          </header>
        )}
        {children}
      </div>
    </div>
  );
}
