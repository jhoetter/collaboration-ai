/**
 * Runtime config seam.
 *
 * The same React tree is mounted twice: standalone (`apps/web`) where
 * the API lives at the same origin and identity is minted on first
 * paint via `demo:onboard`, and embedded (hof-os data-app) where the
 * host owns identity, supplies a JWT, and proxies API + WS through
 * `/api/chat/...`.
 *
 * Network code (`callFunction`, `useEventStream`, EventSource, raw
 * fetches) reads the active config from the module-level singleton so
 * non-React callers (Zustand stores, top-level fetches) work the same
 * as React components. The provider just keeps the singleton in sync
 * with the React lifecycle so HMR / route remounts pick up changes.
 */
import { createContext, useContext, useEffect, useMemo, type ReactNode } from "react";

export interface RuntimeIdentity {
  id: string;
  name: string;
  email?: string;
  avatarUrl?: string | null;
}

export interface RuntimeConfig {
  /** Empty string → same-origin (standalone). e.g. "/api/chat" when embedded. */
  apiBase: string;
  /**
   * Optional WebSocket origin. When omitted we derive `ws(s)://<host>`
   * from `location` at call time. Embeds set this to the proxy's WS
   * mount (e.g. `wss://app.example.com/api/chat`).
   */
  wsBase?: string;
  identity?: RuntimeIdentity;
  workspaceId?: string;
  /** Returns a bearer token. Empty string ⇒ no Authorization header. */
  getAuthToken?: () => Promise<string>;
}

const DEFAULT: RuntimeConfig = { apiBase: "" };

let _config: RuntimeConfig = DEFAULT;

export function setRuntimeConfig(next: RuntimeConfig | null): void {
  _config = next ?? DEFAULT;
}

export function getRuntimeConfig(): RuntimeConfig {
  return _config;
}

export function runtimeApiBase(): string {
  return stripTrailingSlash(_config.apiBase || "");
}

/** Returns the `ws(s)://...` prefix for opening sockets, no trailing `/`. */
export function runtimeWsBase(): string {
  if (_config.wsBase) return stripTrailingSlash(_config.wsBase);
  if (typeof location !== "undefined") {
    const proto = location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${location.host}${runtimeApiBase()}`;
  }
  return "";
}

export async function runtimeAuthHeaders(): Promise<Record<string, string>> {
  const get = _config.getAuthToken;
  if (!get) return {};
  try {
    const token = await get();
    if (!token) return {};
    return { Authorization: `Bearer ${token}` };
  } catch {
    return {};
  }
}

const RuntimeConfigContext = createContext<RuntimeConfig | null>(null);

export interface RuntimeConfigProviderProps {
  runtime?: RuntimeConfig | null;
  children: ReactNode;
}

export function RuntimeConfigProvider({ runtime, children }: RuntimeConfigProviderProps) {
  const value = useMemo<RuntimeConfig>(() => runtime ?? DEFAULT, [runtime]);
  // Set the singleton synchronously during render. Children
  // (`useEventStream`, EventSource, `callFunction`) read the
  // singleton during their own render via `runtimeApiBase()` /
  // `runtimeWsBase()`. If we deferred to a mount effect the first
  // render would see the standalone default — producing
  // origin-relative `/api/...` (404 HTML in the host data-app) and
  // bare `ws://host/ws` (proxy 404, retry storm). Idempotent
  // assignment is safe to do during render for module-level
  // singletons; cleanup still runs in `useEffect` for unmount.
  if (_config !== value) {
    setRuntimeConfig(value);
  }
  useEffect(() => {
    setRuntimeConfig(value);
    return () => {
      setRuntimeConfig(null);
    };
  }, [value]);
  return <RuntimeConfigContext.Provider value={value}>{children}</RuntimeConfigContext.Provider>;
}

export function useRuntimeConfig(): RuntimeConfig {
  return useContext(RuntimeConfigContext) ?? DEFAULT;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
