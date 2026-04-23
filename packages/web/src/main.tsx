import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router";
import "./index.css";
import { DialogProvider } from "./lib/dialogs.tsx";
import { I18nProvider, useTranslator } from "./lib/i18n/index.ts";
import { ThemeProvider } from "./lib/theme/index.ts";
import { useAuth } from "./state/auth.ts";
import { WorkspaceShell } from "./pages/WorkspaceShell.tsx";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <DialogProvider>
            <BrowserRouter>
              <Routes>
                <Route path="/" element={<Bootstrap />} />
                <Route path="/w/:workspaceId/*" element={<WorkspaceShell />} />
              </Routes>
            </BrowserRouter>
          </DialogProvider>
        </QueryClientProvider>
      </ThemeProvider>
    </I18nProvider>
  </React.StrictMode>
);

/**
 * Landing route. Mints (or restores) the per-browser anonymous
 * identity, joins the demo workspace via `demo:onboard`, and
 * redirects into the workspace shell. Acts as a stand-in for the
 * login flow for the duration of the standalone demo.
 */
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
  }, [status, workspaceId, navigate]);

  if (status === "error") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive-bg p-4 text-sm text-destructive">
          <p className="mb-2 font-semibold">{t("common.joinWorkspaceError")}</p>
          <p className="mb-3 opacity-80">{error}</p>
          <p className="text-xs opacity-70">{t("common.didYouRunSeed", { cmd: "make seed" })}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
      {t("common.joiningWorkspace")}
    </main>
  );
}

export { Bootstrap };
