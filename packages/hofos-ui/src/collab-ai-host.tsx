import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router";
import "../../web/src/index.css";
import { DialogProvider } from "../../web/src/lib/dialogs";
import { I18nProvider, useTranslator } from "../../web/src/lib/i18n";
import { RuntimeConfigProvider, type RuntimeConfig } from "../../web/src/lib/runtime-config";
import { ThemeProvider } from "../../web/src/lib/theme";
import { WorkspaceShell } from "../../web/src/pages/WorkspaceShell";
import { useAuth } from "../../web/src/state/auth";

export interface CollabAiHostProps {
  runtime?: RuntimeConfig;
}

export interface CollabAiRouteDefinition {
  path: string;
}

export const product = "collabai" as const;

export const collabAiRoutes: CollabAiRouteDefinition[] = [
  { path: "/chat" },
  { path: "/chat/c/:channelId" },
  { path: "/chat/c/:channelId?thread=:messageId" },
];

const queryClient = new QueryClient();

export function CollabAiHost({ runtime }: CollabAiHostProps) {
  hydrateRuntimeIdentity(runtime);

  const content = (
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <DialogProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Bootstrap />} />
                <Route path="/w/:workspaceId/*" element={<WorkspaceShell />} />
                <Route path="/chat/*" element={<WorkspaceShell />} />
              </Routes>
            </BrowserRouter>
          </DialogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  );

  return runtime ? <RuntimeConfigProvider runtime={runtime}>{content}</RuntimeConfigProvider> : content;
}

function hydrateRuntimeIdentity(runtime: RuntimeConfig | undefined) {
  if (!runtime?.identity?.id || !runtime.workspaceId) return;
  const current = useAuth.getState();
  const displayName = runtime.identity.name || runtime.identity.email || runtime.identity.id;
  if (
    current.status === "ready" &&
    current.identity?.user_id === runtime.identity.id &&
    current.identity?.display_name === displayName &&
    current.workspaceId === runtime.workspaceId
  ) {
    return;
  }
  current.hydrate({
    identity: { user_id: runtime.identity.id, display_name: displayName },
    workspaceId: runtime.workspaceId,
    defaultChannelId: null,
  });
}

function Bootstrap() {
  const status = useAuth((s) => s.status);
  const error = useAuth((s) => s.error);
  const workspaceId = useAuth((s) => s.workspaceId);
  const bootstrap = useAuth((s) => s.bootstrap);
  const navigate = useNavigate();
  const { t } = useTranslator();

  useEffect(() => {
    void bootstrap();
  }, [bootstrap]);

  useEffect(() => {
    if (status === "ready" && workspaceId) {
      navigate(`/w/${workspaceId}`, { replace: true });
    }
  }, [navigate, status, workspaceId]);

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6 text-sm text-destructive">
        {error}
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      {t("common.joiningWorkspace")}
    </main>
  );
}
