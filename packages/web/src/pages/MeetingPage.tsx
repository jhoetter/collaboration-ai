/**
 * Full-page meeting route — Google Meet–style URL: shareable, deep-linkable.
 *
 * URL: `/w/:workspaceId/c/:channelId/meet`
 *
 * Owns the lobby → room transition. The route is mounted ABOVE the
 * `WorkspaceShell` (see `main.tsx`) so the meeting fills the viewport
 * with no app chrome — no TopBar, no Sidebar, no ChannelHeader.
 *
 * Auth: re-uses the same anonymous-identity bootstrap as the rest of
 * the app. Anyone with a valid identity *and* membership in the channel
 * can land on the page directly via the shared link, just like Meet.
 */
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { MeetingLobby } from "../components/meeting/MeetingLobby.tsx";
import { MeetingRoom, type MeetingDevicePrefs } from "../components/meeting/MeetingRoom.tsx";
import { useEventStream } from "../hooks/useEventStream.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync } from "../state/sync.ts";
import { useUsers } from "../state/users.ts";

type Phase = "lobby" | "room";

export function MeetingPage() {
  const { workspaceId, channelId } = useParams<{ workspaceId: string; channelId: string }>();
  const authedWorkspaceId = useAuth((s) => s.workspaceId);
  const authStatus = useAuth((s) => s.status);
  const authError = useAuth((s) => s.error);
  const bootstrap = useAuth((s) => s.bootstrap);
  const channel = useSync((s) => (channelId ? s.channels[channelId] : undefined));
  const navigate = useNavigate();
  const { t } = useTranslator();
  const effectiveWorkspaceId = workspaceId ?? authedWorkspaceId ?? undefined;

  const [phase, setPhase] = useState<Phase>("lobby");
  const [devices, setDevices] = useState<MeetingDevicePrefs | null>(null);

  // Mirror WorkspaceShell's bootstrap so direct hits to /meet (refresh,
  // shared link in a new tab) hydrate the auth + workspace state.
  useEffect(() => {
    if (authStatus === "idle") void bootstrap();
  }, [authStatus, bootstrap]);

  // Subscribe to the event stream so we know about huddle.start/join/
  // leave/end while we're sitting in the lobby and so the projection's
  // channel name is hydrated.
  useEventStream(effectiveWorkspaceId);

  const hydrate = useUsers((s) => s.hydrate);
  useEffect(() => {
    if (effectiveWorkspaceId && authStatus === "ready") {
      void hydrate(effectiveWorkspaceId);
    }
  }, [effectiveWorkspaceId, authStatus, hydrate]);

  if (!channelId || !effectiveWorkspaceId) {
    return (
      <main className="flex h-[100dvh] items-center justify-center bg-background text-sm text-tertiary">
        {t("meeting.errors.noChannel")}
      </main>
    );
  }

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
        </div>
      </main>
    );
  }

  function backToChannel() {
    navigate(`/w/${effectiveWorkspaceId}/c/${channelId}`);
  }

  if (phase === "lobby" || !devices) {
    return (
      <MeetingLobby
        channelId={channelId}
        channelName={channel?.name}
        onJoin={(d) => {
          setDevices(d);
          setPhase("room");
        }}
        onCancel={backToChannel}
      />
    );
  }

  return (
    <MeetingRoom
      channelId={channelId}
      workspaceId={effectiveWorkspaceId}
      channelName={channel?.name}
      devices={devices}
      onLeft={backToChannel}
    />
  );
}
