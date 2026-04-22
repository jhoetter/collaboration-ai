/**
 * Light / dark / system colour-scheme helper.
 *
 * Mirrors `hof-os`'s app-shell `colorScheme.ts` exactly — only the
 * class names + storage key are namespaced to collab. Selecting
 * `"system"` removes both override classes so the
 * `@media (prefers-color-scheme)` rule inside the active preset wins.
 */

export const COLOR_SCHEME_STORAGE_KEY = "collabai.theme";

export type ColorScheme = "light" | "dark" | "system";

const VALID: ReadonlySet<string> = new Set(["light", "dark", "system"]);

export function getStoredColorScheme(): ColorScheme {
  if (typeof window === "undefined") return "system";
  try {
    const raw = window.localStorage.getItem(COLOR_SCHEME_STORAGE_KEY);
    if (raw && VALID.has(raw)) return raw as ColorScheme;
  } catch {
    /* localStorage may be disabled */
  }
  return "system";
}

export function setStoredColorScheme(scheme: ColorScheme): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, scheme);
  } catch {
    /* localStorage may be disabled */
  }
}

const LIGHT_CLASS = "collab-theme-light";
const DARK_CLASS = "collab-theme-dark";

/**
 * Toggle the override class on `<html>`. `"system"` clears both so
 * the `@media (prefers-color-scheme: dark)` rule in the active
 * preset takes over.
 */
export function applyColorScheme(scheme: ColorScheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.remove(LIGHT_CLASS, DARK_CLASS);
  if (scheme === "light") root.classList.add(LIGHT_CLASS);
  else if (scheme === "dark") root.classList.add(DARK_CLASS);
}

export function getEffectiveColorScheme(scheme: ColorScheme): "light" | "dark" {
  if (scheme === "light" || scheme === "dark") return scheme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
