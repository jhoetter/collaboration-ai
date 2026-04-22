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
import { Button } from "@collabai/ui";
import {
  ControlBar,
  GridLayout,
  LiveKitRoom,
  ParticipantTile,
  RoomAudioRenderer,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { useEffect, useState } from "react";
import { callFunction } from "../lib/api.ts";
import { useSync } from "../state/sync.ts";

interface TokenResponse {
  url: string;
  token: string;
  room: string;
}

export function HuddlePanel({
  channelId,
  onClose,
}: {
  channelId: string;
  onClose: () => void;
}) {
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    <div className="fixed bottom-4 left-1/2 z-40 w-[min(640px,90vw)] -translate-x-1/2 rounded-lg border border-border bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-foreground">Huddle</p>
          <p className="text-xs text-tertiary">
            {huddle ? `${huddle.participants.length} on call` : "Connecting…"}
          </p>
        </div>
        <Button variant="danger" size="sm" onClick={() => void handleLeave()}>
          Leave
        </Button>
      </header>
      {error && (
        <div className="px-3 py-2 text-xs text-destructive">
          Could not start huddle: {error}
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
          className="overflow-hidden rounded-b-lg"
          style={{ height: 360 }}
        >
          <HuddleStage />
          <RoomAudioRenderer />
          <ControlBar variation="minimal" controls={{ camera: true, microphone: true, screenShare: false, leave: false }} />
        </LiveKitRoom>
      ) : !error ? (
        <div className="p-6 text-center text-xs text-tertiary">Connecting…</div>
      ) : null}
    </div>
  );
}

function HuddleStage() {
  const tracks = useTracks(
    [
      { source: Track.Source.Camera, withPlaceholder: true },
      { source: Track.Source.ScreenShare, withPlaceholder: false },
    ],
    { onlySubscribed: false },
  );
  return (
    <GridLayout tracks={tracks} style={{ height: "calc(100% - 60px)" }}>
      <ParticipantTile />
    </GridLayout>
  );
}
