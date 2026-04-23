import { useEffect } from "react";
import { Route, Routes, useLocation, useParams } from "react-router";
import { CommandPalette } from "../components/CommandPalette.tsx";
import { MembersPanel } from "../components/MembersPanel.tsx";
import { Sidebar } from "../components/Sidebar.tsx";
import { SidebarPanel } from "../components/SidebarPanel.tsx";
import { ThreadPane } from "../components/ThreadPane.tsx";
import { ToastHost } from "../components/ToastHost.tsx";
import { TopBar } from "../components/TopBar.tsx";
import { useUi } from "../state/ui.ts";
import { useEventStream } from "../hooks/useEventStream.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync } from "../state/sync.ts";
import { useThread } from "../state/threads.ts";
import { useUsers } from "../state/users.ts";
import { ChannelPage } from "./ChannelPage.tsx";

interface UnreadRow {
  channel_id: string;
  unread: number;
  mention_count: number;
  last_sequence: number;
}

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

  // Seed per-channel unread counts from the server's projection so DMs
  // (and any channel whose recent history didn't fit in the initial
  // /api/sync window) show the correct bold + badge in the sidebar
  // immediately after load. Live events keep it up-to-date afterwards.
  const hydrateUnread = useSync((s) => s.hydrateUnread);
  useEffect(() => {
    if (!effectiveWorkspaceId || authStatus !== "ready") return;
    let cancelled = false;
    void callFunction<UnreadRow[]>("unread:by-channel", {})
      .then((rows) => {
        if (cancelled || !Array.isArray(rows)) return;
        hydrateUnread(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspaceId, authStatus, hydrateUnread]);

  const threadOpen = useThread((s) => s.rootId !== null);
  const sidebarOpen = useUi((s) => s.sidebarOpen);
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  const location = useLocation();

  // Close the mobile drawer whenever the user navigates so tapping a
  // channel doesn't leave the sidebar covering the new pane.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname, setSidebarOpen]);

  // Escape closes the drawer (desktop ignores the flag entirely).
  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sidebarOpen, setSidebarOpen]);

  if (authStatus === "joining" || authStatus === "idle") {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-background text-sm text-tertiary">
        {t("common.joiningWorkspace")}
      </main>
    );
  }
  if (authStatus === "error") {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-background p-6">
        <div className="max-w-md rounded-lg border border-destructive/40 bg-destructive-bg p-4 text-sm text-destructive">
          <p className="mb-2 font-semibold">{t("common.joinWorkspaceError")}</p>
          <p className="mb-3 opacity-80">{authError}</p>
          <p className="text-xs opacity-70">{t("common.didYouRunSeed", { cmd: "make seed" })}</p>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-[100dvh] flex-col">
      <TopBar />
      <div className="relative flex flex-1 min-h-0">
        {sidebarOpen && (
          <button
            type="button"
            aria-label={t("common.close")}
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-30 bg-foreground/40 backdrop-blur-sm lg:hidden"
          />
        )}
        <div
          className={`fixed inset-y-0 left-0 z-40 w-72 transform transition-transform duration-200 ease-out lg:static lg:z-auto lg:w-64 lg:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : "-translate-x-full"
          }`}
        >
          <Sidebar />
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <Routes>
            <Route index element={<EmptyState />} />
            <Route path="c/:channelId" element={<ChannelPage />} />
          </Routes>
        </main>
        {threadOpen && <ThreadPane />}
        <MembersRail />
        <SidebarPanel />
      </div>
      <CommandPalette />
      <ToastHost />
    </div>
  );
}

function MembersRail() {
  const open = useUi((s) => s.membersPanelOpen);
  if (!open) return null;
  return (
    <Routes>
      <Route path="c/:channelId" element={<MembersPanelForRoute />} />
    </Routes>
  );
}

function MembersPanelForRoute() {
  const { channelId } = useParams<{ channelId: string }>();
  if (!channelId) return null;
  return <MembersPanel channelId={channelId} />;
}

function EmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center text-sm text-tertiary">
      Pick a channel from the sidebar to start chatting.
    </div>
  );
}
