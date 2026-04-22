/**
 * Activity inbox: a flat, time-ordered list of every notification the
 * current user has received (mention, reply-in-followed-thread,
 * reaction-on-mine, channel-invite). Clicking a row jumps to the source
 * message and silently calls `notifications:mark-read`.
 */
import { Avatar, IconActivity, IconAt, IconHash, IconReply, IconSmile } from "@collabai/ui";
import { useMemo } from "react";
import { useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useSync, type NotificationRow } from "../state/sync.ts";

export function Activity() {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslator();
  const notifications = useSync((s) => s.notifications);
  const channels = useSync((s) => s.channels);
  const setNotificationRead = useSync((s) => s.setNotificationRead);

  const rows = useMemo(
    () =>
      Object.values(notifications).sort(
        (a, b) => b.created_at - a.created_at,
      ),
    [notifications],
  );

  function jump(n: NotificationRow) {
    if (!n.read) {
      void callFunction("notifications:mark-read", { notification_id: n.id }).catch(
        () => undefined,
      );
      setNotificationRead(n.id);
    }
    if (n.channel_id) {
      const anchor = n.target_event_id ? `#message-${n.target_event_id}` : "";
      navigate(`/w/${params.workspaceId}/c/${n.channel_id}${anchor}`);
    }
  }

  return (
    <section className="flex h-full flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
        <IconActivity size={16} />
        <h1 className="text-sm font-semibold text-foreground">
          {t("activity.title")}
        </h1>
        <span className="text-xs text-tertiary">
          {t("activity.count", { n: rows.length })}
        </span>
      </header>
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <span className="rounded-full bg-accent-light p-3 text-accent">
              <IconActivity size={20} />
            </span>
            <h2 className="text-base font-semibold text-foreground">
              {t("activity.emptyTitle")}
            </h2>
            <p className="max-w-md text-sm text-secondary">
              {t("activity.emptyBody")}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((n) => (
              <ActivityRow
                key={n.id}
                row={n}
                channelName={channels[n.channel_id ?? ""]?.name ?? n.channel_id ?? ""}
                onJump={() => jump(n)}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ActivityRow({
  row,
  channelName,
  onJump,
}: {
  row: NotificationRow;
  channelName: string;
  onJump: () => void;
}) {
  const { t } = useTranslator();
  const senderId = row.target_event_id ? row.target_event_id.split(":")[0] : "";
  const senderName = useDisplayName(senderId);
  const KindIcon = iconForKind(row.kind);
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-hover ${
          row.read ? "" : "bg-accent-light/30"
        }`}
      >
        <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full bg-card text-accent">
          <KindIcon size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm">
            {senderName && (
              <span className="flex items-center gap-1.5">
                <Avatar name={senderName} kind="human" size={16} />
                <span className="font-semibold text-foreground">{senderName}</span>
              </span>
            )}
            <span className="text-tertiary">{labelForKind(row.kind, t)}</span>
            {channelName && (
              <span className="inline-flex items-center gap-0.5 text-tertiary">
                <IconHash size={10} />
                <span className="truncate">{channelName}</span>
              </span>
            )}
            <span className="ml-auto whitespace-nowrap text-xs text-tertiary">
              {formatRelative(row.created_at)}
            </span>
          </span>
          {row.body && (
            <span className="mt-1 line-clamp-2 block text-sm text-secondary">{row.body}</span>
          )}
        </span>
      </button>
    </li>
  );
}

function iconForKind(kind: string) {
  switch (kind) {
    case "mention":
      return IconAt;
    case "reply":
    case "thread":
      return IconReply;
    case "reaction":
      return IconSmile;
    default:
      return IconActivity;
  }
}

function labelForKind(kind: string, t: (k: string) => string): string {
  switch (kind) {
    case "mention":
      return t("activity.mentionedYou");
    case "reply":
    case "thread":
      return t("activity.replied");
    case "reaction":
      return t("activity.reacted");
    case "invite":
      return t("activity.invited");
    default:
      return kind;
  }
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  const mins = Math.floor(delta / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(ts).toLocaleDateString();
}
