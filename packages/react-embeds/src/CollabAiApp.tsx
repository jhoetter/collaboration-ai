/**
 * Top-level embed for hof-os (and any other host) that wants to mount
 * the full collaboration-ai workspace inline.
 *
 * Reuses the standalone `WorkspaceShell` (sidebar, channel list, thread
 * pane, presence) verbatim under a `MemoryRouter` so deep links inside
 * the embed don't bleed into the host's URL bar. Identity / API base /
 * JWT come in via `hooks` and are mirrored into the runtime-config
 * singleton + the auth store before the shell renders.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router";
import { type RuntimeConfig, type RuntimeIdentity } from "../../web/src/lib/runtime-config.tsx";
import { useAuth } from "../../web/src/state/auth.ts";
import { WorkspaceShell, type WorkspaceShellChrome } from "../../web/src/pages/WorkspaceShell.tsx";
import { AppProviders } from "./AppProviders.js";

export interface CollabAiHostHooks {
  /** Base URL of the proxy (e.g. "/api/chat"); empty for same-origin. */
  apiUrl: string;
  /** Optional ws(s):// origin override; falls back to derive-from-location. */
  wsUrl?: string;
  /** Workspace the embed should land in. Maps to JWT `tid`. */
  workspaceId: string;
  /** Presence identity surfaced to other workspace members. */
  presenceUser: RuntimeIdentity;
  /** Optional default channel to navigate to on first paint. */
  defaultChannelId?: string | null;
  /**
   * Mints a short-lived JWT for the sidecar. Called for every
   * outbound HTTP/WS request, so cache aggressively on the host side.
   */
  onAuth(): Promise<{ token: string }>;
}

export interface CollabAiAppProps {
  hooks: CollabAiHostHooks;
  /**
   * Visual chrome mode forwarded to {@link WorkspaceShell}.
   *
   * - `"full"` (default) renders the standalone chrome (TopBar with
   *   workspace search). Matches the legacy v0.2.0 behaviour.
   * - `"content"` drops the TopBar so a host (e.g. hof-os) can supply
   *   its own header without a duplicated search row. The channel-list
   *   sidebar is preserved.
   */
  chrome?: WorkspaceShellChrome;
}

/**
 * @deprecated For embed use; standalone-only.
 *
 * `CollabAiApp` mounts the full `WorkspaceShell` (sidebar + main pane
 * + thread rail + command palette) inside a `MemoryRouter`. It's the
 * legacy "all-or-nothing" embed surface — it works, but couples the
 * host to collab-ai's chrome.
 *
 * Hosts integrating from v0.3.0 onwards should compose the headless
 * pieces instead — `CollabAiProvider` + `CollabAiChannelList` +
 * `CollabAiChannel` + `CollabAiThreadPane` + `CollabAiActivityPane`
 * (+ `collabaiCommands`, `CollabAiSearchInput`) — and supply their
 * own chrome around them. The standalone web app keeps using
 * `CollabAiApp` directly.
 */
export function CollabAiApp({ hooks, chrome = "full" }: CollabAiAppProps) {
  const runtime = useMemo<RuntimeConfig>(() => runtimeConfigFromHooks(hooks), [hooks]);
  return (
    <AppProviders runtime={runtime}>
      <CollabHydrator hooks={hooks}>
        <MemoryRouter initialEntries={[`/w/${encodeURIComponent(hooks.workspaceId)}`]}>
          <Routes>
            <Route path="/w/:workspaceId/*" element={<WorkspaceShell chrome={chrome} />} />
            <Route
              path="*"
              element={<Navigate to={`/w/${encodeURIComponent(hooks.workspaceId)}`} replace />}
            />
          </Routes>
        </MemoryRouter>
      </CollabHydrator>
    </AppProviders>
  );
}

/**
 * Pushes the host-supplied identity into the auth store before the
 * router renders, so `WorkspaceShell` short-circuits the
 * `bootstrap()` (demo:onboard) path and runs against the JWT's
 * tenant immediately.
 *
 * The `useAuth.hydrate()` call is idempotent; we re-hydrate whenever
 * `hooks` changes (host swaps tenant) but otherwise it's a single
 * synchronous setState before first paint.
 */
function CollabHydrator({ hooks, children }: { hooks: CollabAiHostHooks; children: ReactNode }) {
  const hydrate = useAuth((s) => s.hydrate);
  // Block first render until hydration runs; without this the
  // workspace shell mounts with status=idle and races the bootstrap
  // path before the host identity is in place.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    hydrate({
      identity: {
        user_id: hooks.presenceUser.id,
        display_name: hooks.presenceUser.name,
      },
      workspaceId: hooks.workspaceId,
      defaultChannelId: hooks.defaultChannelId ?? null,
    });
    setHydrated(true);
  }, [hooks, hydrate]);
  if (!hydrated) return null;
  return <>{children}</>;
}

function runtimeConfigFromHooks(hooks: CollabAiHostHooks): RuntimeConfig {
  const cfg: RuntimeConfig = {
    apiBase: stripTrailingSlash(hooks.apiUrl),
    identity: hooks.presenceUser,
    workspaceId: hooks.workspaceId,
    async getAuthToken(): Promise<string> {
      const t = await hooks.onAuth();
      return t.token;
    },
  };
  if (hooks.wsUrl) {
    return { ...cfg, wsBase: hooks.wsUrl };
  }
  return cfg;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}
