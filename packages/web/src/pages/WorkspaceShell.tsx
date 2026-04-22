import { useEffect } from "react";
import { Route, Routes, useParams } from "react-router";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { ThreadPane } from "../components/ThreadPane.tsx";
import { useEventStream } from "../hooks/useEventStream.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useThread } from "../state/threads.ts";
import { useUsers } from "../state/users.ts";
import { AgentInbox } from "./AgentInbox.tsx";
import { ChannelPage } from "./ChannelPage.tsx";

export function WorkspaceShell() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const authedWorkspaceId = useAuth((s) => s.workspaceId);
  const authStatus = useAuth((s) => s.status);
  const authError = useAuth((s) => s.error);
  const bootstrap = useAuth((s) => s.bootstrap);
  const { t } = useTranslator();
  const effectiveWorkspaceId = workspaceId ?? authedWorkspaceId ?? undefined;

  // The `/` Bootstrap route also calls `bootstrap()`, but a direct hit
  // on `/w/:workspaceId/...` (refresh, deep link, second tab) skips
  // it — without this, every `callFunction(...)` would 422 because
  // `actor_id` and `workspace_id` are read from the auth store.
  useEffect(() => {
    if (authStatus === "idle") void bootstrap();
  }, [authStatus, bootstrap]);

  useEventStream(effectiveWorkspaceId);

  const hydrate = useUsers((s) => s.hydrate);
  useEffect(() => {
    if (effectiveWorkspaceId && authStatus === "ready") {
      void hydrate(effectiveWorkspaceId);
    }
  }, [effectiveWorkspaceId, authStatus, hydrate]);

  const threadOpen = useThread((s) => s.rootId !== null);

  if (authStatus === "joining" || authStatus === "idle") {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-950 text-sm text-slate-500">
        {t("common.joiningWorkspace")}
      </main>
    );
  }
  if (authStatus === "error") {
    return (
      <main className="flex h-screen items-center justify-center bg-slate-950 p-6">
        <div className="max-w-md rounded-lg border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200">
          <p className="mb-2 font-semibold">{t("common.joinWorkspaceError")}</p>
          <p className="mb-3 text-rose-300/80">{authError}</p>
          <p className="text-xs text-rose-300/60">
            {t("common.didYouRunSeed", { cmd: "make seed" })}
          </p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen">
      <Sidebar />
      <main className="flex flex-1 flex-col">
        <Routes>
          <Route index element={<EmptyState />} />
          <Route path="c/:channelId" element={<ChannelPage />} />
          <Route
            path="agent-inbox"
            element={<EmptyState label="Open agent inbox in the right rail." />}
          />
        </Routes>
      </main>
      {threadOpen ? <ThreadPane /> : <AgentInbox />}
      <CommandPalette />
    </div>
  );
}

function EmptyState({ label }: { label?: string } = {}) {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
      {label ?? "Pick a channel from the sidebar to start chatting."}
    </div>
  );
}
