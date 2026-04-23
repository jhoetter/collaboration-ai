/**
 * Shared provider stack used by both the standalone web app and the
 * embedded `CollabAiApp` mount.
 *
 * Mirrors the wrapping in packages/web/src/main.tsx so the same React
 * tree (theme, i18n, react-query, dialogs) lights up regardless of
 * host. The new `RuntimeConfigProvider` is the single seam that
 * differentiates standalone (no overrides → same-origin / cookie auth)
 * from embedded (host supplies apiBase, identity, JWT).
 *
 * The relative import into `../../web/src` is intentional: esbuild
 * inlines the tree at build time, the resulting `dist/index.js` is
 * fully self-contained, and we keep a single source of truth for the
 * shell so standalone + embed never drift.
 */
import { type ReactNode, useEffect, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../web/src/lib/i18n/index.ts";
import { ThemeProvider } from "../../web/src/lib/theme/index.ts";
import { DialogProvider } from "../../web/src/lib/dialogs.tsx";
import { RuntimeConfigProvider, type RuntimeConfig } from "../../web/src/lib/runtime-config.tsx";
import { useAuth } from "../../web/src/state/auth.ts";

export interface AppProvidersProps {
  runtime?: RuntimeConfig | null;
  children: ReactNode;
}

export function AppProviders({ runtime = null, children }: AppProvidersProps) {
  // One QueryClient per AppProviders instance so the standalone app
  // (created at module scope in main.tsx) and the embed (created on
  // mount) both get a clean cache without leaking across reloads.
  const queryClient = useMemo(() => new QueryClient(), []);
  return (
    <RuntimeConfigProvider runtime={runtime}>
      <RuntimeAuthBridge runtime={runtime}>
        <I18nProvider>
          <ThemeProvider>
            <QueryClientProvider client={queryClient}>
              <DialogProvider>{children}</DialogProvider>
            </QueryClientProvider>
          </ThemeProvider>
        </I18nProvider>
      </RuntimeAuthBridge>
    </RuntimeConfigProvider>
  );
}

/**
 * Bridges a host-supplied `RuntimeConfig` into the internal `useAuth`
 * Zustand store.
 *
 * Background: the legacy `CollabAiApp` mount has its own
 * `CollabHydrator` that pushes the host's identity + workspace into
 * `useAuth.hydrate(...)` before the workspace shell renders. The
 * headless v0.3.0 composables (`<CollabAiProvider>`, `<ChannelView>`,
 * `<AgentInbox>`, ...) used by the hof-os data-app embed went straight
 * through `AppProviders` without that step, so the auth store stayed
 * `status: "idle"` with `identity: null`. The result was every
 * embedded surface showing "Du bist Anonym" and an empty channel list
 * even though the host had passed valid identity + workspaceId via
 * `runtime`.
 *
 * This bridge closes that gap: when the runtime carries both an
 * identity and a workspaceId (the embedded path), we mirror exactly
 * what `CollabHydrator` does. When either is missing (the standalone
 * web app path) we no-op and let the app's own `bootstrap()` /
 * `demo:onboard` flow keep ownership of hydration.
 *
 * Unlike `CollabHydrator` we do NOT block rendering on hydration — the
 * headless embed must mount and paint immediately even if identity
 * arrives asynchronously, so children render unconditionally and
 * downstream components react to the auth store as it fills in.
 */
function RuntimeAuthBridge({ runtime, children }: { runtime: RuntimeConfig | null; children: ReactNode }) {
  const identityId = runtime?.identity?.id;
  const identityName = runtime?.identity?.name;
  const workspaceId = runtime?.workspaceId;
  useEffect(() => {
    if (!identityId || !workspaceId) return;
    useAuth.getState().hydrate({
      identity: {
        user_id: identityId,
        display_name: identityName ?? identityId,
      },
      workspaceId,
      defaultChannelId: null,
    });
    // String deps avoid re-running on every parent re-render that
    // produces a new `runtime` object identity but the same values.
  }, [identityId, identityName, workspaceId]);
  return <>{children}</>;
}
