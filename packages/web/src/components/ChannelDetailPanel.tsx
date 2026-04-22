/**
 * Slack-style channel detail panel.
 *
 * Replaces the older `ChannelSettingsModal` with a wider, tabbed dialog
 * that the channel header opens on click. Tabs:
 *
 *  - About    name, topic, description, leave / archive actions.
 *  - Members  the joined member list (kept from the previous modal).
 *  - Files    every non-link attachment ever sent in the channel,
 *             derived from the local projection (no extra round-trip).
 *  - Pinned   `chat:list-pinned` results with jump-to-permalink.
 *
 * The panel is a `Modal` with a wide max-width so the file/pinned
 * lists have breathing room; the header remains uncluttered (just the
 * channel name).
 */
import {
  Avatar,
  Button,
  IconDownload,
  IconExternal,
  IconPin,
  Modal,
} from "@collabai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useDialogs } from "../lib/dialogs.tsx";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment, type Channel } from "../state/sync.ts";
import { FileTypeIcon } from "./FileTypeIcon.tsx";

export type DetailTab = "about" | "members" | "files" | "pinned";

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
}

interface PinnedRow {
  message_id: string;
  pinned_at: number;
  pinned_by: string;
  content: string;
  sender_id: string;
  sender_type: string;
  created_at: number;
}

interface FileEntry {
  attachment: Attachment;
  message_id: string;
  sender_id: string;
  ts: number;
}

export interface ChannelDetailPanelProps {
  channel: Channel;
  members: MemberRow[];
  initialTab?: DetailTab;
  onClose: () => void;
}

export function ChannelDetailPanel({
  channel,
  members,
  initialTab = "about",
  onClose,
}: ChannelDetailPanelProps) {
  const { t } = useTranslator();
  const [tab, setTab] = useState<DetailTab>(initialTab);
  const isDm = channel.type === "dm" || channel.type === "group_dm";
  const title = isDm
    ? channel.name
    : `#${channel.name}`;

  return (
    <Modal onClose={onClose} title={title} size="lg" className="!max-w-3xl">
      <div className="border-b border-border">
        <nav className="flex" role="tablist">
          <TabButton
            active={tab === "about"}
            onClick={() => setTab("about")}
            label={t("channelDetail.tabAbout")}
          />
          <TabButton
            active={tab === "members"}
            onClick={() => setTab("members")}
            label={`${t("channelDetail.tabMembers")} (${members.length})`}
          />
          {!isDm && (
            <TabButton
              active={tab === "files"}
              onClick={() => setTab("files")}
              label={t("channelDetail.tabFiles")}
            />
          )}
          {!isDm && (
            <TabButton
              active={tab === "pinned"}
              onClick={() => setTab("pinned")}
              label={t("channelDetail.tabPinned")}
            />
          )}
        </nav>
      </div>
      {tab === "about" && (
        <AboutTab channel={channel} isDm={isDm} onClose={onClose} />
      )}
      {tab === "members" && <MembersTab channel={channel} members={members} />}
      {tab === "files" && !isDm && <FilesTab channelId={channel.id} />}
      {tab === "pinned" && !isDm && (
        <PinnedTab channelId={channel.id} onJump={onClose} />
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`px-4 py-2 text-sm transition-colors duration-150 ${
        active
          ? "border-b-2 border-accent text-foreground"
          : "border-b-2 border-transparent text-secondary hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

// ───────── About ─────────

function AboutTab({
  channel,
  isDm,
  onClose,
}: {
  channel: Channel;
  isDm: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslator();
  const { confirm } = useDialogs();
  const qc = useQueryClient();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [description, setDescription] = useState(channel.description ?? "");
  const [busy, setBusy] = useState(false);

  async function saveAbout() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { channel_id: channel.id };
      if (name !== channel.name) payload.name = name;
      if (topic !== (channel.topic ?? "")) payload.topic = topic;
      if (description !== (channel.description ?? "")) payload.description = description;
      if (Object.keys(payload).length > 1) {
        await callFunction("channel:update", payload);
      }
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    const ok = await confirm({
      title: t("dialogs.archiveChannelTitle"),
      description: t("channelDetail.archiveConfirm", { channel: channel.name }),
      confirmLabel: t("channelDetail.archive"),
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await callFunction("channel:archive", { channel_id: channel.id });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!confirm(t("members.leaveConfirm", { channel: channel.name }))) return;
    setBusy(true);
    try {
      await callFunction("channel:leave", { channel_id: channel.id });
      qc.invalidateQueries({ queryKey: ["channel-members", channel.id] });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  if (isDm) {
    return (
      <div className="p-6 text-sm text-secondary">
        {t("channelHeader.dmHint")}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Field label={t("channelDetail.fieldName")}>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      </Field>
      <Field label={t("channelDetail.fieldTopic")}>
        <input
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          placeholder={t("channelDetail.fieldTopicPlaceholder")}
        />
      </Field>
      <Field label={t("channelDetail.fieldDescription")}>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          placeholder={t("channelDetail.fieldDescriptionPlaceholder")}
        />
      </Field>
      <div className="flex justify-between gap-2 pt-2">
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => void leave()} disabled={busy}>
            {t("members.leaveChannel")}
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => void archive()}
            disabled={busy || !!channel.archived}
          >
            {t("channelDetail.archive")}
          </Button>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => void saveAbout()}
            disabled={busy}
          >
            {t("common.save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ───────── Members ─────────

function MembersTab({
  channel,
  members,
}: {
  channel: Channel;
  members: MemberRow[];
}) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { t } = useTranslator();

  async function kick(userId: string) {
    if (!confirm(t("members.removeConfirm", { name: userId, channel: channel.name }))) {
      return;
    }
    setBusy(true);
    try {
      await callFunction("channel:kick", { channel_id: channel.id, user_id: userId });
      qc.invalidateQueries({ queryKey: ["channel-members", channel.id] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <ul className="max-h-[60vh] overflow-y-auto p-2">
      {members.map((m) => (
        <li
          key={m.user_id}
          className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-hover"
        >
          <Avatar name={m.display_name} kind="human" size={28} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm text-foreground">{m.display_name}</p>
            <p className="truncate text-xs text-tertiary">{m.role}</p>
          </div>
          {m.user_id !== me && (
            <button
              type="button"
              disabled={busy}
              className="text-xs text-tertiary transition-colors hover:text-destructive disabled:opacity-40"
              onClick={() => void kick(m.user_id)}
            >
              {t("members.remove")}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// ───────── Files ─────────

function FilesTab({ channelId }: { channelId: string }) {
  const messages = useSync((s) => s.messagesByChannel[channelId] ?? []);
  const { t } = useTranslator();
  const entries = useMemo<FileEntry[]>(() => {
    const out: FileEntry[] = [];
    for (const m of messages) {
      if (m.redacted) continue;
      for (const a of m.attachments ?? []) {
        const kind = (a as Attachment & { kind?: string }).kind;
        if (kind === "link_preview") continue;
        out.push({
          attachment: a,
          message_id: m.id,
          sender_id: m.sender_id,
          ts: m.origin_ts,
        });
      }
    }
    out.sort((a, b) => b.ts - a.ts);
    return out;
  }, [messages]);

  if (entries.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-tertiary">
        {t("channelDetail.filesEmpty")}
      </div>
    );
  }

  return (
    <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border">
      {entries.map((e) => (
        <FileRow key={`${e.message_id}-${e.attachment.file_id}`} entry={e} />
      ))}
    </ul>
  );
}

function FileRow({ entry }: { entry: FileEntry }) {
  const { t } = useTranslator();
  const senderName = useDisplayName(entry.sender_id);
  const date = new Date(entry.ts).toLocaleDateString();
  const sizeKb = entry.attachment.size_bytes
    ? `${Math.max(1, Math.round(entry.attachment.size_bytes / 1024))} KB`
    : "";
  return (
    <li className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-hover">
      <FileTypeIcon mime={entry.attachment.mime} size={28} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {entry.attachment.name}
        </p>
        <p className="truncate text-xs text-tertiary">
          {senderName || entry.sender_id} · {date}
          {sizeKb ? ` · ${sizeKb}` : ""}
        </p>
      </div>
      <button
        type="button"
        title={t("channelDetail.download")}
        className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground"
        onClick={() => void downloadAttachment(entry.attachment)}
      >
        <IconDownload />
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

// ───────── Pinned ─────────

function PinnedTab({
  channelId,
  onJump,
}: {
  channelId: string;
  onJump: () => void;
}) {
  const { t } = useTranslator();
  const navigate = useNavigate();
  const params = useParams<{ workspaceId: string }>();
  const { data = [], isLoading } = useQuery({
    queryKey: ["channel-pinned", channelId],
    queryFn: () =>
      callFunction<PinnedRow[]>("chat:list-pinned", { channel_id: channelId }),
    refetchOnWindowFocus: false,
  });

  if (isLoading) {
    return (
      <div className="p-6 text-center text-sm text-tertiary">
        {t("common.loading")}
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-tertiary">
        {t("channelDetail.pinnedEmpty")}
      </div>
    );
  }

  function jump(messageId: string) {
    if (!params.workspaceId) return;
    navigate(`/w/${params.workspaceId}/c/${channelId}#${messageId}`);
    onJump();
  }

  return (
    <ul className="max-h-[60vh] overflow-y-auto divide-y divide-border">
      {data.map((p) => (
        <PinnedRowView key={p.message_id} row={p} onJump={() => jump(p.message_id)} />
      ))}
    </ul>
  );
}

function PinnedRowView({
  row,
  onJump,
}: {
  row: PinnedRow;
  onJump: () => void;
}) {
  const senderName = useDisplayName(row.sender_id);
  const pinnedAt = new Date(row.pinned_at).toLocaleString();
  const { t } = useTranslator();
  return (
    <li className="flex items-start gap-3 px-3 py-3">
      <span className="mt-0.5 text-tertiary">
        <IconPin />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-tertiary">
          {senderName || row.sender_id} · {pinnedAt}
        </p>
        <p className="line-clamp-3 text-sm text-foreground">{row.content}</p>
      </div>
      <button
        type="button"
        title={t("channelDetail.jumpToMessage")}
        className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground"
        onClick={onJump}
      >
        <IconExternal />
      </button>
    </li>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-tertiary">
      <span>{label}</span>
      {children}
    </label>
  );
}
