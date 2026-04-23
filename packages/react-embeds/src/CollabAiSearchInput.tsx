/**
 * Headless workspace search input.
 *
 * A tiny controlled `<input>` that hosts can drop into their own
 * top-bar / palette without inheriting any collab-ai chrome. The
 * input itself is fully controlled (`value`, `onChange`); pressing
 * Enter (or submitting the wrapping form) bubbles up through
 * `onSearch` so the host can route it to its own search results
 * surface or call `search:messages` directly.
 *
 * Visual styling stays minimal and inherits the host's foreground /
 * background CSS variables — no hardcoded colours or fonts so the
 * input visually disappears into the host's chrome.
 */
import { useCallback, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";

export interface CollabAiSearchInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Fired on Enter (or form submit) with the current value, trimmed. */
  onSearch?: (query: string) => void;
  placeholder?: string;
  /** Optional class merged onto the input for layout overrides. */
  className?: string;
  /** Forwarded to the input — useful for a11y labels. */
  "aria-label"?: string;
}

export function CollabAiSearchInput({
  value,
  onChange,
  onSearch,
  placeholder = "Search messages…",
  className,
  "aria-label": ariaLabel,
}: CollabAiSearchInputProps) {
  const handleChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value),
    [onChange]
  );

  const submit = useCallback(() => {
    const q = value.trim();
    if (!q) return;
    onSearch?.(q);
  }, [value, onSearch]);

  const handleKey = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    },
    [submit]
  );

  const handleSubmit = useCallback(
    (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      submit();
    },
    [submit]
  );

  return (
    <form role="search" onSubmit={handleSubmit} className="flex w-full min-w-0">
      <input
        type="search"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKey}
        placeholder={placeholder}
        aria-label={ariaLabel ?? placeholder}
        className={
          className ??
          "h-8 w-full min-w-0 rounded-md border border-divider bg-background px-2 text-sm text-foreground outline-none placeholder:text-tertiary focus:ring-2 focus:ring-accent/40"
        }
        data-testid="collabai-search-input"
      />
    </form>
  );
}
