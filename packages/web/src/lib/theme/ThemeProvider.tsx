import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  applyColorScheme,
  getEffectiveColorScheme,
  getStoredColorScheme,
  setStoredColorScheme,
  type ColorScheme,
} from "./colorScheme.ts";

interface ThemeContextValue {
  /** User intent: "light" | "dark" | "system". */
  readonly colorScheme: ColorScheme;
  /** What the page is actually rendering as right now. */
  readonly resolvedScheme: "light" | "dark";
  setColorScheme(next: ColorScheme): void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export interface ThemeProviderProps {
  readonly children: ReactNode;
  /** Mostly for tests — bypass localStorage and OS detection. */
  readonly initialScheme?: ColorScheme;
}

/**
 * Mounts at the root of the app. Reads the persisted preference on
 * mount, applies the matching `<html>` class, and listens to the OS
 * `prefers-color-scheme` change event so the resolved theme stays
 * fresh when the user picks `"system"`.
 */
export function ThemeProvider({ children, initialScheme }: ThemeProviderProps) {
  const [colorScheme, setSchemeState] = useState<ColorScheme>(
    initialScheme ?? "system",
  );
  const [resolvedScheme, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const next = initialScheme ?? getStoredColorScheme();
    setSchemeState(next);
    applyColorScheme(next);
    setResolved(getEffectiveColorScheme(next));
  }, [initialScheme]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (colorScheme === "system") {
        setResolved(media.matches ? "dark" : "light");
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [colorScheme]);

  const setColorScheme = useCallback((next: ColorScheme) => {
    setStoredColorScheme(next);
    applyColorScheme(next);
    setSchemeState(next);
    setResolved(getEffectiveColorScheme(next));
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ colorScheme, resolvedScheme, setColorScheme }),
    [colorScheme, resolvedScheme, setColorScheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useColorScheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    return {
      colorScheme: "system",
      resolvedScheme: "light",
      setColorScheme: () => undefined,
    };
  }
  return ctx;
}
