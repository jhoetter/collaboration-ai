/**
 * Read-only summary view for a *past* meeting.
 *
 * URL: `/w/:workspaceId/c/:channelId/meet/:huddleId`
 *
 * Displays metadata pulled from `meeting:get` (title, host, duration,
 * participants) and reserves placeholder slots for the future
 * recording/transcript surfaces (Phase 6 — schema is ready, UI is
 * intentionally not wired yet).
 *
 * The page deliberately re-uses the workspace shell's chrome so users
 * can navigate back to the channel naturally — past meetings live
 * inside the channel context, unlike the live meeting which takes
 * over the whole viewport.
 */
import { Avatar, Button, IconExternal, IconVideo } from "@collabai/ui";
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useSync } from "../state/sync.ts";

interface MeetingDetails {
  huddle_id: string;
  channel_id: string;
  workspace_id: string;
  livekit_room: string;
  started_by: string;
  started_at: number;
  ended_at: number | null;
  title: string | null;
  recording_url: string | null;
  transcript_url: string | null;
  ended_reason: string | null;
  participants: Array<{
    user_id: string;
    joined_at: number;
    left_at: number | null;
    role: string;
  }>;
}

export function MeetingSummaryPage() {
  const params = useParams<{ workspaceId: string; channelId: string; huddleId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslator();
  const channel = useSync((s) =>
    params.channelId ? s.channels[params.channelId] : undefined
  );

  const { data, isLoading, error } = useQuery({
    queryKey: ["meeting", params.huddleId],
    queryFn: () => callFunction<MeetingDetails>("meeting:get", { huddle_id: params.huddleId }),
    enabled: !!params.huddleId,
    refetchOnWindowFocus: false,
  });

  if (!params.workspaceId || !params.channelId || !params.huddleId) {
    return null;
  }

  function backToChannel() {
    navigate(`/w/${params.workspaceId}/c/${params.channelId}`);
  }

  return (
    <section className="flex h-full flex-1 flex-col overflow-y-auto bg-background">
      <header className="flex flex-none items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
        <div className="min-w-0">
          <p className="truncate text-xs uppercase tracking-wide text-tertiary">
            {channel?.name ? `# ${channel.name}` : params.channelId}
          </p>
          <h1 className="truncate text-base font-semibold text-foreground">
            {data?.title || t("meetingSummary.fallbackTitle")}
          </h1>
        </div>
        <Button variant="secondary" size="sm" onClick={backToChannel}>
          {t("meetingSummary.backToChannel")}
        </Button>
      </header>

      {isLoading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-tertiary">
          {t("common.loading")}
        </div>
      ) : error || !data ? (
        <div className="m-4 rounded-md border border-destructive/40 bg-destructive-bg p-4 text-sm text-destructive">
          {t("meetingSummary.notFound")}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-3xl space-y-6 p-4 lg:p-8">
          <SummaryCard meeting={data} />
          <ParticipantsCard meeting={data} />
          <PlaceholdersCard meeting={data} />
        </div>
      )}
    </section>
  );
}

function SummaryCard({ meeting }: { meeting: MeetingDetails }) {
  const { t } = useTranslator();
  const startedByName = useDisplayName(meeting.started_by);
  const startedAt = new Date(meeting.started_at).toLocaleString();
  const endedAt = meeting.ended_at ? new Date(meeting.ended_at).toLocaleString() : null;
  const duration = meeting.ended_at
    ? formatDuration(meeting.ended_at - meeting.started_at)
    : t("meetingSummary.inProgress");

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent/15 text-accent">
          <IconVideo />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-foreground">
            {meeting.title || t("meetingSummary.fallbackTitle")}
          </p>
          <p className="text-xs text-tertiary">
            {t("meetingSummary.startedBy", { name: startedByName || meeting.started_by })}
          </p>
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <DataField label={t("meetingSummary.startedAt")} value={startedAt} />
        <DataField
          label={t("meetingSummary.endedAt")}
          value={endedAt ?? t("meetingSummary.inProgress")}
        />
        <DataField label={t("meetingSummary.duration")} value={duration} />
        <DataField
          label={t("meetingSummary.endedReason")}
          value={
            meeting.ended_reason
              ? t(`meetingSummary.reason.${meeting.ended_reason}`)
              : "—"
          }
        />
      </dl>
    </div>
  );
}

function ParticipantsCard({ meeting }: { meeting: MeetingDetails }) {
  const { t } = useTranslator();
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h2 className="text-sm font-semibold text-foreground">
        {t("meetingSummary.participants", { n: meeting.participants.length })}
      </h2>
      {meeting.participants.length === 0 ? (
        <p className="mt-2 text-xs text-tertiary">{t("meetingSummary.noParticipants")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {meeting.participants.map((p) => (
            <ParticipantRow key={p.user_id} row={p} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ParticipantRow({
  row,
}: {
  row: MeetingDetails["participants"][number];
}) {
  const name = useDisplayName(row.user_id);
  const joined = new Date(row.joined_at).toLocaleTimeString();
  const left = row.left_at ? new Date(row.left_at).toLocaleTimeString() : "—";
  const duration = row.left_at ? formatDuration(row.left_at - row.joined_at) : "—";
  return (
    <li className="flex items-center gap-3 py-2">
      <Avatar name={name || row.user_id} kind="human" size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-foreground">{name || row.user_id}</p>
        <p className="truncate text-xs text-tertiary">
          {joined} → {left} · {duration}
        </p>
      </div>
    </li>
  );
}

function PlaceholdersCard({ meeting }: { meeting: MeetingDetails }) {
  const { t } = useTranslator();
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-5">
      <h2 className="text-sm font-semibold text-foreground">
        {t("meetingSummary.assets")}
      </h2>
      <p className="mt-1 text-xs text-tertiary">{t("meetingSummary.assetsHint")}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <AssetSlot
          label={t("meetingSummary.recording")}
          url={meeting.recording_url}
          empty={t("meetingSummary.recordingPending")}
        />
        <AssetSlot
          label={t("meetingSummary.transcript")}
          url={meeting.transcript_url}
          empty={t("meetingSummary.transcriptPending")}
        />
      </div>
    </div>
  );
}

function AssetSlot({ label, url, empty }: { label: string; url: string | null; empty: string }) {
  if (!url) {
    return (
      <div className="rounded-lg border border-border/60 px-3 py-2 text-xs text-tertiary">
        <p className="font-medium text-secondary">{label}</p>
        <p>{empty}</p>
      </div>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center justify-between gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-accent transition-colors hover:bg-accent/20"
    >
      <span className="font-medium">{label}</span>
      <IconExternal size={14} />
    </a>
  );
}

function DataField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] uppercase tracking-wide text-tertiary">{label}</dt>
      <dd className="text-sm text-foreground">{value}</dd>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "0m";
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
