import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Route, Routes, useNavigate } from "react-router";
import "./index.css";
import { useAuth } from "./state/auth.ts";
import { WorkspaceShell } from "./pages/WorkspaceShell.tsx";

const queryClient = new QueryClient();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Bootstrap />} />
          <Route path="/w/:workspaceId/*" element={<WorkspaceShell />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
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
      <main className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
          <p className="mb-2 font-semibold">Couldn't join the demo workspace.</p>
          <p className="mb-3 text-rose-300/80">{error}</p>
          <p className="text-xs text-rose-300/60">
            Did you run <code className="rounded bg-slate-900 px-1">make seed</code> on the
            backend?
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 text-sm text-slate-500">
      Joining workspace…
    </main>
  );
}

export { Bootstrap };
