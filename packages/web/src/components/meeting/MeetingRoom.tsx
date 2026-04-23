/**
 * Full-page meeting room (Google Meet–style).
 *
 * Mounts a `LiveKitRoom` against the channel's active huddle. The
 * frontend never talks to LiveKit's API directly: we exchange the
 * channel id for a short-lived JWT via `huddle:token`, then connect
 * with `livekit-client`.
 *
 * Lifecycle wiring (this component owns the call's runtime):
 *   - On mount: fetch token → mount LiveKitRoom → fire `huddle:join`
 *     (Phase 3) so the participant is reflected in `huddle.participants`
 *     for everyone else.
 *   - Every ~8 minutes: refresh the LiveKit JWT (Phase 3) so calls
 *     longer than the 10-minute TTL don't get kicked.
 *   - On unmount / explicit Leave: dispatch `huddle:leave`.
 *   - Host-only "End for everyone": dispatch `huddle:end`, which the
 *     server projects as `huddle.end` and tears down the room for all
 *     participants.
 *
 * UI is intentionally close to Meet: full-bleed stage, fixed control
 * bar at the bottom, header with title + share-link + leave/end. Use
 * inside `MeetingPage`, which provides the surrounding 100dvh shell.
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
  useRoomContext,
  usePinnedTracks,
  useTracks,
} from "@livekit/components-react";
import "@livekit/components-styles";
import { Track } from "livekit-client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { callFunction } from "../../lib/api.ts";
import { useTranslator } from "../../lib/i18n/index.ts";
import { useAuth } from "../../state/auth.ts";
import { useSync } from "../../state/sync.ts";
import { useToasts } from "../../state/toasts.ts";

interface TokenResponse {
  url: string;
  token: string;
  room: string;
  huddle_id?: string;
}

export interface MeetingDevicePrefs {
  audioInputId?: string | null;
  videoInputId?: string | null;
  audioEnabled: boolean;
  videoEnabled: boolean;
}

interface MeetingRoomProps {
  channelId: string;
  workspaceId: string;
  channelName?: string;
  devices?: MeetingDevicePrefs;
  onLeft: () => void;
}

const TOKEN_REFRESH_INTERVAL_MS = 8 * 60 * 1000;

export function MeetingRoom({
  channelId,
  workspaceId,
  channelName,
  devices,
  onLeft,
}: MeetingRoomProps) {
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const [token, setToken] = useState<TokenResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { t } = useTranslator();
  const navigate = useNavigate();
  const pushToast = useToasts((s) => s.push);

  // Initial token fetch.  Lazy `huddle:start` happens server-side if no
  // huddle exists for this channel yet (see `huddle:token`).
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

  // Once we have a token, the huddle exists; tell the server we joined
  // so other clients see us in `huddle.participants`. Idempotent on the
  // server: if we're already listed, the projector ignores it.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    void callFunction("huddle:join", { channel_id: channelId }).catch((err) => {
      if (!cancelled) console.warn("huddle:join failed", err);
    });
    return () => {
      cancelled = true;
    };
  }, [token, channelId]);

  // Server-issued LiveKit JWTs are short-lived (10 min). Refresh every
  // 8 min to avoid mid-meeting disconnects on long calls. We swap the
  // LiveKit prop and let the SDK pick it up on its next reconnect cycle.
  useEffect(() => {
    if (!token) return;
    const handle = window.setInterval(() => {
      void callFunction<TokenResponse>("huddle:token", { channel_id: channelId })
        .then((res) => setToken((prev) => (prev ? { ...prev, token: res.token } : res)))
        .catch((err) => console.warn("huddle token refresh failed", err));
    }, TOKEN_REFRESH_INTERVAL_MS);
    return () => window.clearInterval(handle);
  }, [token, channelId]);

  const handleLeave = useCallback(async () => {
    try {
      await callFunction("huddle:leave", { channel_id: channelId });
    } catch {
      /* best-effort */
    }
    onLeft();
  }, [channelId, onLeft]);

  const handleEndForAll = useCallback(async () => {
    try {
      await callFunction("huddle:end", { channel_id: channelId });
    } catch (err) {
      console.error("huddle:end failed", err);
    }
    onLeft();
  }, [channelId, onLeft]);

  // Dispatch `huddle:leave` if the tab is closed mid-call so we don't
  // leave a phantom participant in the projection. Keepalive ensures
  // the request is sent even during page teardown.
  useEffect(() => {
    function onBeforeUnload() {
      try {
        navigator.sendBeacon?.(
          `/api/functions/${encodeURIComponent("huddle:leave")}`,
          new Blob(
            [
              JSON.stringify({
                channel_id: channelId,
                actor_id: me ?? undefined,
                workspace_id: workspaceId,
              }),
            ],
            { type: "application/json" }
          )
        );
      } catch {
        /* best-effort */
      }
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [channelId, me, workspaceId]);

  const isHost = !!huddle && !!me && huddle.started_by === me;

  function copyLink() {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/w/${workspaceId}/c/${channelId}/meet`;
    void navigator.clipboard
      ?.writeText(url)
      .then(() =>
        pushToast({ title: t("meeting.linkCopied"), tone: "success", durationMs: 2500 })
      )
      .catch(() =>
        pushToast({ title: t("meeting.linkCopyFailed"), tone: "danger", durationMs: 4000 })
      );
  }

  const roomOptions = useMemo(
    () => ({
      audioCaptureDefaults: devices?.audioInputId
        ? { deviceId: devices.audioInputId }
        : undefined,
      videoCaptureDefaults: devices?.videoInputId
        ? { deviceId: devices.videoInputId }
        : undefined,
    }),
    [devices?.audioInputId, devices?.videoInputId]
  );

  const audioOn = devices?.audioEnabled ?? true;
  const videoOn = devices?.videoEnabled ?? false;

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background text-foreground">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-border bg-surface px-3 py-2 lg:px-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {channelName ? `# ${channelName}` : t("meeting.title")}
          </p>
          <p className="truncate text-xs text-tertiary">
            {huddle
              ? t("meeting.participants", { n: huddle.participants.length })
              : t("meeting.connecting")}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Button variant="secondary" size="sm" onClick={copyLink}>
            {t("meeting.copyLink")}
          </Button>
          {isHost && (
            <Button variant="secondary" size="sm" onClick={() => void handleEndForAll()}>
              {t("meeting.endForAll")}
            </Button>
          )}
          <Button variant="danger" size="sm" onClick={() => void handleLeave()}>
            {t("meeting.leave")}
          </Button>
        </div>
      </header>
      {error && (
        <div className="border-b border-destructive/40 bg-destructive-bg px-4 py-2 text-xs text-destructive">
          {t("meeting.couldNotStart")} {error}
        </div>
      )}
      {token ? (
        <LiveKitRoom
          serverUrl={token.url}
          token={token.token}
          connect
          audio={audioOn}
          video={videoOn}
          options={roomOptions}
          data-lk-theme="default"
          className="flex flex-1 flex-col overflow-hidden"
          onDisconnected={() => {
            // If the server tore the room down (e.g. host ended), make
            // sure we route back to the channel rather than spin on a
            // dead LiveKitRoom.
            navigate(`/w/${workspaceId}/c/${channelId}`);
          }}
        >
          <LayoutContextProvider>
            <div className="flex-1 overflow-hidden bg-background">
              <MeetingStage />
            </div>
            <RoomAudioRenderer />
            <div className="flex-none border-t border-border bg-surface">
              <ControlBar
                variation="minimal"
                controls={{
                  camera: true,
                  microphone: true,
                  screenShare: true,
                  leave: false,
                }}
              />
            </div>
            <DeviceApplier devices={devices} />
          </LayoutContextProvider>
        </LiveKitRoom>
      ) : !error ? (
        <div className="flex flex-1 items-center justify-center text-sm text-tertiary">
          {t("meeting.connecting")}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <Button variant="primary" onClick={() => onLeft()}>
            {t("meeting.backToChannel")}
          </Button>
        </div>
      )}
    </div>
  );
}

function MeetingStage() {
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

/**
 * Re-applies the lobby's device preferences AFTER the local participant
 * is connected. Setting `videoCaptureDefaults` via room options covers
 * the initial publish, but explicit `setMicrophoneEnabled`/
 * `setCameraEnabled` makes sure the user's lobby toggle is honoured
 * regardless of any browser preference cached by LiveKit.
 */
function DeviceApplier({ devices }: { devices?: MeetingDevicePrefs }) {
  const room = useRoomContext();
  const appliedRef = useRef(false);
  useEffect(() => {
    if (!devices) return;
    if (appliedRef.current) return;
    if (!room?.localParticipant) return;
    appliedRef.current = true;
    void Promise.all([
      room.localParticipant.setMicrophoneEnabled(devices.audioEnabled),
      room.localParticipant.setCameraEnabled(devices.videoEnabled),
    ]).catch((err) => console.warn("apply device prefs failed", err));
  }, [devices, room]);
  return null;
}
