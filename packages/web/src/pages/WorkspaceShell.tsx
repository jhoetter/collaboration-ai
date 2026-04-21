import { useEffect } from "react";
import { Route, Routes, useParams } from "react-router";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { useEventStream } from "../hooks/useEventStream.ts";
import { useAuth } from "../state/auth.ts";
import { useUsers } from "../state/users.ts";
import { AgentInbox } from "./AgentInbox.tsx";
import { ChannelPage } from "./ChannelPage.tsx";

export function WorkspaceShell() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const authedWorkspaceId = useAuth((s) => s.workspaceId);
  const effectiveWorkspaceId = workspaceId ?? authedWorkspaceId ?? undefined;

  useEventStream(effectiveWorkspaceId);

  const hydrate = useUsers((s) => s.hydrate);
  useEffect(() => {
    if (effectiveWorkspaceId) void hydrate(effectiveWorkspaceId);
  }, [effectiveWorkspaceId, hydrate]);

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
      <AgentInbox />
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
