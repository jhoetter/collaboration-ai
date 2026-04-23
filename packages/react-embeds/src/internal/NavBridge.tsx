/**
 * Internal helper used by the headless composable embeds
 * (`CollabAiChannelList`, `CollabAiChannel`, …) to bridge the in-embed
 * `MemoryRouter` to the host's outer router.
 *
 * Each headless surface mounts its own `MemoryRouter` so React-Router
 * hooks (`useParams`, `useNavigate`, `Link`) used deep inside the
 * standalone components keep working without colliding with the
 * host's `BrowserRouter`. Whenever the user clicks a `<Link>` (or
 * something else navigates the embed's history), this component
 * observes the location change and relays it to the host through
 * the `onNavigate` prop. The host is then free to mirror the
 * navigation in its own router (e.g. `BrowserRouter`).
 *
 * The first render's location is treated as the seed and not
 * forwarded — only subsequent navigations fire `onNavigate`. That
 * way the host doesn't see a synthetic "navigate to the initial
 * route" event on mount.
 */
import { useEffect, useRef } from "react";
import { useLocation } from "react-router";

export interface NavBridgeProps {
  onNavigate?: (path: string) => void;
}

export function NavBridge({ onNavigate }: NavBridgeProps) {
  const location = useLocation();
  const seeded = useRef(false);
  const lastPath = useRef<string | null>(null);
  useEffect(() => {
    const path = `${location.pathname}${location.search}${location.hash}`;
    if (!seeded.current) {
      seeded.current = true;
      lastPath.current = path;
      return;
    }
    if (lastPath.current === path) return;
    lastPath.current = path;
    onNavigate?.(path);
  }, [location, onNavigate]);
  return null;
}
