/**
 * Pre-join lobby for the Meet-style meeting experience.
 *
 * Requests local mic/cam preview tracks via `getUserMedia` BEFORE
 * publishing anything to the SFU, lets the user pick devices and
 * toggle mic/cam, then hands a {@link MeetingDevicePrefs} bundle to
 * the parent (which mounts {@link MeetingRoom} only after `Join now`
 * is pressed).
 *
 * Design notes:
 *   - Permissions are required for the *preview*, not for joining.
 *     If the user denies, we still let them join with mic/cam off.
 *   - We persist the last-chosen device ids in localStorage under
 *     `meeting:devices` so a refresh lands on the same hardware.
 *   - We deliberately do NOT mount LiveKit until the user clicks
 *     join — anything earlier would publish them silently.
 */
import { Avatar, Button, IconMic, IconVideo } from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useDisplayName } from "../../hooks/useDisplayName.ts";
import { useTranslator } from "../../lib/i18n/index.ts";
import { useAuth } from "../../state/auth.ts";
import { useSync } from "../../state/sync.ts";
import { useUsers } from "../../state/users.ts";
import type { MeetingDevicePrefs } from "./MeetingRoom.tsx";

const STORAGE_KEY = "meeting:devices";

interface StoredPrefs {
  audioInputId?: string;
  videoInputId?: string;
  audioEnabled?: boolean;
  videoEnabled?: boolean;
}

interface DeviceInfo {
  deviceId: string;
  label: string;
}

function loadStoredPrefs(): StoredPrefs {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as StoredPrefs;
  } catch {
    return {};
  }
}

function saveStoredPrefs(prefs: StoredPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* localStorage disabled — non-fatal */
  }
}

interface MeetingLobbyProps {
  channelId: string;
  channelName?: string;
  onJoin: (devices: MeetingDevicePrefs) => void;
  onCancel: () => void;
}

export function MeetingLobby({ channelId, channelName, onJoin, onCancel }: MeetingLobbyProps) {
  const { t } = useTranslator();
  const me = useAuth((s) => s.identity);
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const myName = useDisplayName(me?.user_id ?? null);
  const stored = useMemo(() => loadStoredPrefs(), []);

  const [audioInputId, setAudioInputId] = useState<string | undefined>(stored.audioInputId);
  const [videoInputId, setVideoInputId] = useState<string | undefined>(stored.videoInputId);
  const [audioEnabled, setAudioEnabled] = useState<boolean>(stored.audioEnabled ?? true);
  const [videoEnabled, setVideoEnabled] = useState<boolean>(stored.videoEnabled ?? false);

  const [audioDevices, setAudioDevices] = useState<DeviceInfo[]>([]);
  const [videoDevices, setVideoDevices] = useState<DeviceInfo[]>([]);
  const [permError, setPermError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);

  const previewRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // Acquire / refresh the preview stream whenever the device or
  // enabled flags change. We always tear down the previous stream
  // first so we don't leak a green camera light between selections.
  useEffect(() => {
    let cancelled = false;
    async function acquire() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices) {
        setPermError(t("meeting.lobby.unsupported"));
        return;
      }
      stopStream(streamRef.current);
      streamRef.current = null;
      if (previewRef.current) previewRef.current.srcObject = null;

      if (!audioEnabled && !videoEnabled) return;

      try {
        const constraints: MediaStreamConstraints = {
          audio: audioEnabled
            ? audioInputId
              ? { deviceId: { exact: audioInputId } }
              : true
            : false,
          video: videoEnabled
            ? videoInputId
              ? { deviceId: { exact: videoInputId } }
              : true
            : false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopStream(stream);
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) previewRef.current.srcObject = stream;
        setPermError(null);
        // Once granted, device labels become populated.
        const all = await navigator.mediaDevices.enumerateDevices();
        if (!cancelled) {
          setAudioDevices(toDeviceList(all, "audioinput"));
          setVideoDevices(toDeviceList(all, "videoinput"));
        }
      } catch (err) {
        if (cancelled) return;
        setPermError(err instanceof Error ? err.message : String(err));
      }
    }
    void acquire();
    return () => {
      cancelled = true;
    };
  }, [audioEnabled, videoEnabled, audioInputId, videoInputId, t]);

  // Stop tracks on unmount so we never leak a camera/mic indicator.
  useEffect(() => {
    return () => {
      stopStream(streamRef.current);
      streamRef.current = null;
    };
  }, []);

  // Initial enumeration even before the user grants permission, so we
  // can render the device picker (with empty labels until allowed).
  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.mediaDevices) return;
    void navigator.mediaDevices.enumerateDevices().then((all) => {
      setAudioDevices(toDeviceList(all, "audioinput"));
      setVideoDevices(toDeviceList(all, "videoinput"));
    });
  }, []);

  const userDirectory = useUsers((s) => s.byId);
  const participantNames = (huddle?.participants ?? []).map(
    (uid) => userDirectory[uid]?.display_name ?? uid
  );

  function handleJoin() {
    setJoining(true);
    saveStoredPrefs({ audioInputId, videoInputId, audioEnabled, videoEnabled });
    // Tear down the preview before LiveKit grabs the device — some
    // browsers refuse to re-open the same camera if a track is still
    // live in another <video> element.
    stopStream(streamRef.current);
    streamRef.current = null;
    if (previewRef.current) previewRef.current.srcObject = null;
    onJoin({
      audioInputId: audioInputId ?? null,
      videoInputId: videoInputId ?? null,
      audioEnabled,
      videoEnabled,
    });
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col bg-background text-foreground">
      <header className="flex flex-none items-center justify-between border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">
            {channelName ? `# ${channelName}` : t("meeting.title")}
          </p>
          <p className="truncate text-xs text-tertiary">{t("meeting.lobby.subtitle")}</p>
        </div>
        <Button variant="secondary" size="sm" onClick={onCancel}>
          {t("meeting.lobby.cancel")}
        </Button>
      </header>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-6 lg:flex-row lg:items-stretch lg:justify-center lg:gap-10 lg:px-10">
        <section className="flex w-full max-w-2xl flex-col items-center gap-3">
          <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
            {videoEnabled ? (
              <video
                ref={previewRef}
                autoPlay
                playsInline
                muted
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-tertiary">
                <Avatar name={myName || me?.display_name || "?"} kind="human" size={40} />
                <p className="text-xs">{t("meeting.lobby.cameraOff")}</p>
              </div>
            )}
            <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-2">
              <button
                type="button"
                onClick={() => setAudioEnabled((v) => !v)}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                  audioEnabled
                    ? "border-border bg-surface text-foreground hover:bg-hover"
                    : "border-destructive/60 bg-destructive-bg text-destructive"
                }`}
                aria-label={audioEnabled ? t("meeting.lobby.muteMic") : t("meeting.lobby.unmuteMic")}
                title={audioEnabled ? t("meeting.lobby.muteMic") : t("meeting.lobby.unmuteMic")}
              >
                <IconMic size={16} />
              </button>
              <button
                type="button"
                onClick={() => setVideoEnabled((v) => !v)}
                className={`inline-flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
                  videoEnabled
                    ? "border-border bg-surface text-foreground hover:bg-hover"
                    : "border-destructive/60 bg-destructive-bg text-destructive"
                }`}
                aria-label={videoEnabled ? t("meeting.lobby.cameraOffAction") : t("meeting.lobby.cameraOnAction")}
                title={videoEnabled ? t("meeting.lobby.cameraOffAction") : t("meeting.lobby.cameraOnAction")}
              >
                <IconVideo size={16} />
              </button>
            </div>
          </div>

          {permError && (
            <p className="rounded-md border border-warning/40 bg-warning-bg px-3 py-2 text-xs text-warning">
              {t("meeting.lobby.permissionDenied")} {permError}
            </p>
          )}

          <div className="grid w-full gap-3 sm:grid-cols-2">
            <DevicePicker
              label={t("meeting.lobby.microphone")}
              devices={audioDevices}
              value={audioInputId}
              onChange={setAudioInputId}
              disabled={!audioEnabled}
            />
            <DevicePicker
              label={t("meeting.lobby.camera")}
              devices={videoDevices}
              value={videoInputId}
              onChange={setVideoInputId}
              disabled={!videoEnabled}
            />
          </div>
        </section>

        <section className="flex w-full max-w-sm flex-col items-stretch justify-center gap-4 rounded-xl border border-border bg-card p-6 text-center">
          <div>
            <p className="text-base font-semibold text-foreground">
              {t("meeting.lobby.readyToJoin")}
            </p>
            <p className="mt-1 text-xs text-tertiary">
              {t("meeting.lobby.joiningAs", { name: myName || me?.display_name || "you" })}
            </p>
          </div>
          {participantNames.length > 0 ? (
            <p className="text-xs text-secondary">
              {participantNames.length > 3
                ? t("meeting.lobby.alreadyInCallMore", {
                    names: participantNames.slice(0, 3).join(", "),
                    more: participantNames.length - 3,
                  })
                : t("meeting.lobby.alreadyInCall", { names: participantNames.join(", ") })}
            </p>
          ) : (
            <p className="text-xs text-tertiary">{t("meeting.lobby.noOneYet")}</p>
          )}
          <Button
            variant="primary"
            onClick={handleJoin}
            disabled={joining}
            className="w-full"
          >
            {joining ? t("meeting.lobby.joining") : t("meeting.lobby.joinNow")}
          </Button>
        </section>
      </div>
    </div>
  );
}

function DevicePicker({
  label,
  devices,
  value,
  onChange,
  disabled,
}: {
  label: string;
  devices: DeviceInfo[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex flex-col gap-1 text-left text-xs">
      <span className="font-medium text-secondary">{label}</span>
      <select
        className="rounded-md border border-border bg-card px-2 py-1.5 text-sm text-foreground disabled:opacity-50"
        disabled={disabled || devices.length === 0}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        {devices.length === 0 && <option value="">—</option>}
        {devices.map((d) => (
          <option key={d.deviceId} value={d.deviceId}>
            {d.label || d.deviceId.slice(0, 8)}
          </option>
        ))}
      </select>
    </label>
  );
}

function toDeviceList(all: MediaDeviceInfo[], kind: MediaDeviceKind): DeviceInfo[] {
  return all
    .filter((d) => d.kind === kind && d.deviceId)
    .map((d) => ({ deviceId: d.deviceId, label: d.label }));
}

function stopStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      /* ignore */
    }
  }
}
