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
import { type ReactNode, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { I18nProvider } from "../../web/src/lib/i18n/index.ts";
import { ThemeProvider } from "../../web/src/lib/theme/index.ts";
import { DialogProvider } from "../../web/src/lib/dialogs.tsx";
import { RuntimeConfigProvider, type RuntimeConfig } from "../../web/src/lib/runtime-config.tsx";

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
      <I18nProvider>
        <ThemeProvider>
          <QueryClientProvider client={queryClient}>
            <DialogProvider>{children}</DialogProvider>
          </QueryClientProvider>
        </ThemeProvider>
      </I18nProvider>
    </RuntimeConfigProvider>
  );
}
