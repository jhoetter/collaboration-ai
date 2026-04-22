/**
 * Slack-style floating sidebar panel.
 *
 * Hosts the Activity inbox, Later (saved messages), and Files lists as
 * pop-out overlays anchored to the right of the sidebar. Toggled from
 * `useUi().openSidebarPanel`; closes on Escape, outside click, or by
 * toggling the same trigger again.
 *
 * The panel is rendered as a fixed overlay that floats above the
 * channel pane (Slack matches this pattern from its narrow icon rail).
 * It does not navigate — clicking a row jumps to the source message
 * but keeps the panel open until the user closes it explicitly.
 */
import {
  Avatar,
  IconActivity,
  IconAt,
  IconBookmark,
  IconClock,
  IconClose,
  IconDownload,
  IconFile,
  IconHash,
  IconReply,
  IconSmile,
} from "@collabai/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import {
  useSync,
  type Attachment,
  type Message,
  type NotificationRow,
} from "../state/sync.ts";
import { useUi, type SidebarPanelId } from "../state/ui.ts";
import { FileTypeIcon } from "./FileTypeIcon.tsx";

export function SidebarPanel() {
  const open = useUi((s) => s.openSidebarPanel);
  const setOpen = useUi((s) => s.setOpenSidebarPanel);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(null);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, setOpen]);

  // Outside-click dismiss. We ignore clicks on the trigger buttons
  // (data-sidebar-panel-trigger) so the trigger's own toggle handler
  // can run to its natural conclusion without us racing it.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: globalThis.PointerEvent) {
      const target = e.target as Node | null;
      if (!target) return;
      if (containerRef.current?.contains(target)) return;
      const el = target as HTMLElement;
      if (el.closest?.("[data-sidebar-panel-trigger]")) return;
      setOpen(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open, setOpen]);

  if (!open) return null;
  return (
    <div
      ref={containerRef}
      role="dialog"
      aria-modal={false}
      className="pointer-events-auto fixed inset-x-2 top-14 bottom-2 z-30 flex flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-xl sm:inset-x-3 sm:top-14 sm:bottom-3 lg:inset-x-auto lg:bottom-3 lg:left-[16.5rem] lg:top-14 lg:w-[24rem]"
    >
      <PanelBody panel={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function PanelBody({
  panel,
  onClose,
}: {
  panel: SidebarPanelId;
  onClose: () => void;
}) {
  switch (panel) {
    case "activity":
      return <ActivityPanel onClose={onClose} />;
    case "later":
      return <LaterPanel onClose={onClose} />;
    case "files":
      return <FilesPanel onClose={onClose} />;
    default: {
      const _exhaustive: never = panel;
      void _exhaustive;
      return null;
    }
  }
}

function PanelHeader({
  icon,
  title,
  subtitle,
  onClose,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  onClose: () => void;
}) {
  const { t } = useTranslator();
  return (
    <header className="flex flex-none items-center gap-2 border-b border-border px-3 py-2.5">
      <span className="text-tertiary">{icon}</span>
      <h2 className="flex-1 truncate text-sm font-semibold text-foreground">{title}</h2>
      {subtitle && (
        <span className="text-xs text-tertiary">{subtitle}</span>
      )}
      <button
        type="button"
        onClick={onClose}
        aria-label={t("sidebarPanel.close")}
        className="-mr-1 inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <IconClose size={14} />
      </button>
    </header>
  );
}

function EmptyState({
  icon,
  title,
  body,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
      <span className="rounded-full bg-accent-light p-3 text-accent">{icon}</span>
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="max-w-xs text-xs text-secondary">{body}</p>
    </div>
  );
}

// ───────── Activity ─────────

function ActivityPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslator();
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const notifications = useSync((s) => s.notifications);
  const channels = useSync((s) => s.channels);
  const setNotificationRead = useSync((s) => s.setNotificationRead);

  const rows = useMemo(
    () => Object.values(notifications).sort((a, b) => b.created_at - a.created_at),
    [notifications],
  );

  const jump = useCallback(
    (n: NotificationRow) => {
      if (!n.read) {
        void callFunction("notifications:mark-read", { notification_id: n.id }).catch(
          () => undefined,
        );
        setNotificationRead(n.id);
      }
      if (n.channel_id) {
        const anchor = n.target_event_id ? `#message-${n.target_event_id}` : "";
        navigate(`/w/${params.workspaceId}/c/${n.channel_id}${anchor}`);
        onClose();
      }
    },
    [navigate, onClose, params.workspaceId, setNotificationRead],
  );

  return (
    <>
      <PanelHeader
        icon={<IconActivity size={14} />}
        title={t("activity.title")}
        subtitle={t("activity.count", { n: rows.length })}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconActivity size={18} />}
            title={t("activity.emptyTitle")}
            body={t("activity.emptyBody")}
          />
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
    </>
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
        className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-hover ${
          row.read ? "" : "bg-accent-light/30"
        }`}
      >
        <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full bg-card text-accent">
          <KindIcon size={12} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {senderName && (
              <span className="flex min-w-0 items-center gap-1">
                <Avatar name={senderName} kind="human" size={16} />
                <span className="truncate font-semibold text-foreground">
                  {senderName}
                </span>
              </span>
            )}
            <span className="text-tertiary">{labelForKind(row.kind, t)}</span>
            {channelName && (
              <span className="inline-flex min-w-0 items-center gap-0.5 text-tertiary">
                <IconHash size={10} />
                <span className="truncate">{channelName}</span>
              </span>
            )}
            <span className="ml-auto whitespace-nowrap text-[10px] text-tertiary">
              {formatRelative(row.created_at)}
            </span>
          </span>
          {row.body && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-secondary">
              {row.body}
            </span>
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

// ───────── Later (Saved) ─────────

function LaterPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslator();
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const messageById = useSync((s) => s.messageById);
  const channels = useSync((s) => s.channels);
  const starsByUser = useSync((s) => s.starsByUser);

  const rows = useMemo(() => {
    const ids = me ? starsByUser[me] ?? [] : [];
    const out: Message[] = [];
    for (const id of ids) {
      const m = messageById[id];
      if (m) out.push(m);
    }
    out.sort((a, b) => b.origin_ts - a.origin_ts);
    return out;
  }, [me, starsByUser, messageById]);

  return (
    <>
      <PanelHeader
        icon={<IconClock size={14} />}
        title={t("sidebarPanel.later.title")}
        subtitle={t("sidebarPanel.later.count", { n: rows.length })}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto">
        {rows.length === 0 ? (
          <EmptyState
            icon={<IconBookmark size={18} />}
            title={t("sidebarPanel.later.emptyTitle")}
            body={t("sidebarPanel.later.emptyBody")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((m) => (
              <LaterRow
                key={m.id}
                message={m}
                channelName={channels[m.channel_id]?.name ?? m.channel_id}
                onJump={() => {
                  navigate(
                    `/w/${params.workspaceId}/c/${m.channel_id}#message-${m.id}`,
                  );
                  onClose();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function LaterRow({
  message,
  channelName,
  onJump,
}: {
  message: Message;
  channelName: string;
  onJump: () => void;
}) {
  const senderName = useDisplayName(message.sender_id);
  return (
    <li>
      <button
        type="button"
        onClick={onJump}
        className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-hover"
      >
        <IconBookmark
          size={12}
          fill="currentColor"
          className="mt-1 flex-none text-accent"
        />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs">
            {senderName && (
              <span className="truncate font-semibold text-foreground">
                {senderName}
              </span>
            )}
            <span className="inline-flex min-w-0 items-center gap-0.5 text-tertiary">
              <IconHash size={10} />
              <span className="truncate">{channelName}</span>
            </span>
            <span className="ml-auto whitespace-nowrap text-[10px] text-tertiary">
              {formatRelative(message.origin_ts)}
            </span>
          </span>
          {message.content && (
            <span className="mt-0.5 line-clamp-2 block text-xs text-secondary">
              {message.content}
            </span>
          )}
        </span>
      </button>
    </li>
  );
}

// ───────── Files ─────────

interface FileEntry {
  attachment: Attachment;
  channelId: string;
  messageId: string;
  senderId: string;
  ts: number;
}

function FilesPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslator();
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const messageById = useSync((s) => s.messageById);
  const channels = useSync((s) => s.channels);

  const entries = useMemo<FileEntry[]>(() => {
    const out: FileEntry[] = [];
    for (const m of Object.values(messageById)) {
      if (m.redacted) continue;
      for (const a of m.attachments ?? []) {
        if (a.kind === "link_preview") continue;
        out.push({
          attachment: a,
          channelId: m.channel_id,
          messageId: m.id,
          senderId: m.sender_id,
          ts: m.origin_ts,
        });
      }
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [messageById]);

  return (
    <>
      <PanelHeader
        icon={<IconFile size={14} />}
        title={t("sidebarPanel.files.title")}
        subtitle={t("sidebarPanel.files.count", { n: entries.length })}
        onClose={onClose}
      />
      <div className="flex-1 overflow-y-auto">
        {entries.length === 0 ? (
          <EmptyState
            icon={<IconFile size={18} />}
            title={t("sidebarPanel.files.emptyTitle")}
            body={t("sidebarPanel.files.emptyBody")}
          />
        ) : (
          <ul className="divide-y divide-border">
            {entries.map((e) => (
              <FileRow
                key={`${e.messageId}-${e.attachment.file_id}`}
                entry={e}
                channelName={channels[e.channelId]?.name ?? e.channelId}
                onJump={() => {
                  navigate(
                    `/w/${params.workspaceId}/c/${e.channelId}#message-${e.messageId}`,
                  );
                  onClose();
                }}
              />
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function FileRow({
  entry,
  channelName,
  onJump,
}: {
  entry: FileEntry;
  channelName: string;
  onJump: () => void;
}) {
  const { t } = useTranslator();
  const senderName = useDisplayName(entry.senderId);
  const sizeKb = entry.attachment.size_bytes
    ? `${Math.max(1, Math.round(entry.attachment.size_bytes / 1024))} KB`
    : "";
  return (
    <li className="flex items-center gap-2.5 px-3 py-2 transition-colors hover:bg-hover">
      <button
        type="button"
        onClick={onJump}
        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
      >
        <FileTypeIcon mime={entry.attachment.mime} size={28} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {entry.attachment.name}
          </span>
          <span className="block truncate text-[11px] text-tertiary">
            {senderName || entry.senderId}
            {channelName ? ` · ${t("sidebarPanel.files.inChannel", { channel: channelName })}` : ""}
            {sizeKb ? ` · ${sizeKb}` : ""}
          </span>
        </span>
      </button>
      <button
        type="button"
        title={t("channelDetail.download")}
        className="flex-none rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground"
        onClick={() => void downloadAttachment(entry.attachment)}
      >
        <IconDownload size={14} />
      </button>
    </li>
  );
}

async function downloadAttachment(attachment: Attachment) {
  try {
    const res = await callFunction<{ get_url: string }>("attachment:download-url", {
      file_id: attachment.file_id,
    });
    if (res.get_url) window.open(res.get_url, "_blank", "noopener,noreferrer");
  } catch (err) {
    console.error("download failed", err);
  }
}

// ───────── Helpers ─────────

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
