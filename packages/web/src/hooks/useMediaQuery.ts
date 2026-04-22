/**
 * Tiny `window.matchMedia` hook.
 *
 * Subscribes to a media-query string and re-renders when its match
 * status flips. Used by responsive bits of the UI that can't be
 * expressed purely via Tailwind classes — for example, picking a
 * smaller avatar size on mobile or defaulting the composer's
 * formatting toolbar to closed below `md`.
 */
import { useEffect, useState } from "react";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}
