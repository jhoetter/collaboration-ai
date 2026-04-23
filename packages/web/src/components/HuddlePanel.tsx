/**
 * Huddle bottom-sheet — joins the LiveKit room minted by the backend
 * for a given channel. Audio defaults to on, camera off; participants
 * appear in a strip with mic/cam state. Closing the panel hangs up.
 *
 * The frontend never talks to LiveKit's API directly: we exchange the
 * channel id for a short-lived JWT via `huddle:token`, then connect
 * with `livekit-client`. Server also broadcasts a `huddle.start`
 * system message, which lets other tabs/users see the active huddle
 * via `huddlesByChannel` in the sync store.
 */
/**
 * Huddle bottom-sheet — joins the LiveKit room minted by the backend
 * for a given channel. Audio defaults to on, camera off; participants
 * appear in a strip with mic/cam state. Closing the panel hangs up.
 *
 * Screen-sharing is enabled via the LiveKit ControlBar.  When a remote
 * participant publishes a screen track we promote it to the main stage
 * (focus layout) and shrink the camera tiles into a side-strip — same
 * UX pattern as Slack/Zoom huddles.
 */
import { Button } from "@collabai/ui";
import {
  CarouselLayout,
  ControlBar,
  FocusLayout,
  FocusLayoutContainer,
  GridLayout,
  LayoutContextProvider,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { useEffect, useState } from "react";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useSync } from "../state/sync.ts";

interface TokenResponse {
  url: string;
  token: string;
  room: string;
}

export function HuddlePanel({ channelId, onClose }: { channelId: string; onClose: () => void }) {
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslator();

  useEffect(() => {
    let cancelled = false;
    void callFunction<TokenResponse>("huddle:token", { channel_id: channelId })
      .then((res) => {
        if (!cancelled) setToken(res);
      })
      .catch((err) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [channelId]);

  async function handleLeave() {
    try {
      await callFunction("huddle:leave", { channel_id: channelId });
    } catch {
      /* best-effort */
    }
    onClose();
  }

  return (
    <div className="fixed inset-x-2 bottom-2 z-40 flex flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(820px,92vw)] md:-translate-x-1/2">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-foreground">{t("huddle.title")}</p>
          <p className="text-xs text-tertiary">
            {huddle ? t("huddle.participants", { n: huddle.participants.length }) : t("huddle.connecting")}
          </p>
        </div>
        <Button variant="danger" size="sm" onClick={() => void handleLeave()}>
          {t("huddle.leave")}
        </Button>
      </header>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          {t("huddle.couldNotStart")} {error}
        </div>
      )}
      {token ? (
        <LiveKitRoom
          serverUrl={token.url}
          token={token.token}
          connect
          audio
          video={false}
          data-lk-theme="default"
          className="flex h-[60dvh] flex-col md:h-[460px]"
        >
          <LayoutContextProvider>
            <div className="flex-1 overflow-hidden bg-background">
              <HuddleStage />
            </div>
            <RoomAudioRenderer />
            <ControlBar
              variation="minimal"
              controls={{
                camera: true,
                microphone: true,
                screenShare: true,
                leave: false,
              }}
            />
          </LayoutContextProvider>
        </LiveKitRoom>
      ) : !error ? (
        <div className="p-6 text-center text-xs text-tertiary">{t("huddle.connecting")}</div>
      ) : null}
    </div>
  );
}

function HuddleStage() {
  // Subscribe to camera + screen-share tracks. Camera tiles render
  // placeholders so participants without video still show up in the
  // grid; screen-share tiles never render placeholders (a placeholder
  // for "no screen share" makes no sense and would clutter the stage).
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false }
  );
  // If anyone is sharing their screen, focus that track and rail the
  // others on the right; otherwise show the standard equal-share grid.
  const focusTrack = usePinnedTracks() ?? [];
  const screenShareTrack = tracks.find((t) => t.source === Track.Source.ScreenShare);
  const focused = focusTrack[0] ?? screenShareTrack;
  if (focused) {
    return (
      <FocusLayoutContainer>
        <CarouselLayout tracks={tracks.filter((t) => t !== focused)}>
          <ParticipantTile />
        </CarouselLayout>
        <FocusLayout trackRef={focused} />
      </FocusLayoutContainer>
    );
  }
  return (
    <GridLayout tracks={tracks} style={{ height: "100%" }}>
      <ParticipantTile />
    </GridLayout>
  );
}
