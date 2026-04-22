/**
 * Slack-style left rail.
 *
 * Sections (collapsible):
 *  - Channels (public + private the user joined, archived hidden)
 *  - Direct Messages (DMs + group DMs)
 *  - Mentions (unread mention notifications)
 *  - Drafts (channels with persisted drafts)
 *
 * Each channel row shows its unread + mention badge, derived from
 * `notifications` and `readUpToByChannel` slices of the sync store.
 */
import { Avatar, ChannelIcon, PresenceDot, type PresenceStatus as DotStatus } from "@collabai/ui";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Channel, type PresenceStatus } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { ChannelCreateModal } from "./ChannelCreateModal.tsx";
import { NewDmModal } from "./NewDmModal.tsx";
import { UserMenu } from "./UserMenu.tsx";

export function Sidebar() {
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  const channels = useSync((s) => s.channels);
  const messagesByChannel = useSync((s) => s.messagesByChannel);
  const readUpToByChannel = useSync((s) => s.readUpToByChannel);
  const notifications = useSync((s) => s.notifications);
  const draftsByChannel = useSync((s) => s.draftsByChannel);
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const navigate = useNavigate();
  const { t } = useTranslator();
  const createOpen = useUi((s) => s.createChannelOpen);
  const newDmOpen = useUi((s) => s.newDmOpen);
  const setCreateOpen = useUi((s) => s.setCreateChannelOpen);
  const setNewDmOpen = useUi((s) => s.setNewDmOpen);

  const { rooms, dms } = useMemo(() => {
    const rooms: Channel[] = [];
    const dms: Channel[] = [];
    for (const c of Object.values(channels)) {
      if (c.archived) continue;
      if (c.type === "dm" || c.type === "group_dm") dms.push(c);
      else rooms.push(c);
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name));
    return { rooms, dms };
  }, [channels]);

  const unreadByChannel = useMemo(() => {
    const out: Record<string, { unread: number; mentions: number }> = {};
    for (const channelId of Object.keys(channels)) {
      const list = messagesByChannel[channelId] ?? [];
      const cap = readUpToByChannel[channelId] ?? 0;
      let unread = 0;
      for (const m of list) {
        if (m.sequence > cap && m.sender_id !== me) unread += 1;
      }
      out[channelId] = { unread, mentions: 0 };
    }
    for (const n of Object.values(notifications)) {
      if (n.read || n.kind !== "mention" || !n.channel_id) continue;
      if (!out[n.channel_id]) out[n.channel_id] = { unread: 0, mentions: 0 };
      out[n.channel_id].mentions += 1;
    }
    return out;
  }, [channels, messagesByChannel, readUpToByChannel, notifications, me]);

  const mentionRows = useMemo(
    () => Object.values(notifications).filter((n) => !n.read && n.kind === "mention"),
    [notifications],
  );

  const draftRows = useMemo(
    () =>
      Object.entries(draftsByChannel)
        .filter(([, v]) => Boolean(v.content?.trim()))
        .map(([id, v]) => ({ id, content: v.content })),
    [draftsByChannel],
  );


  return (
    <aside className="flex w-64 flex-col gap-1 border-r border-slate-800 bg-slate-900 p-2">
      <UserMenu />

      <SectionHeader
        label={t("sidebar.channels")}
        action={{ label: t("sidebar.addChannel"), onClick: () => setCreateOpen(true) }}
      />
      {rooms.length === 0 && (
        <p className="px-2 text-xs text-slate-500">{t("sidebar.noChannels")}</p>
      )}
      {rooms.map((c) => (
        <ChannelRow
          key={c.id}
          channel={c}
          to={`/w/${params.workspaceId}/c/${c.id}`}
          active={params.channelId === c.id}
          unread={unreadByChannel[c.id]}
        />
      ))}

      <SectionHeader
        label={t("sidebar.directMessages")}
        action={{ label: t("sidebar.newDm"), onClick: () => setNewDmOpen(true) }}
      />
      {dms.length === 0 && (
        <p className="px-2 text-xs text-slate-500">{t("sidebar.noDms")}</p>
      )}
      {dms.map((c) => (
        <DmRow
          key={c.id}
          channel={c}
          to={`/w/${params.workspaceId}/c/${c.id}`}
          active={params.channelId === c.id}
          unread={unreadByChannel[c.id]}
        />
      ))}

      {mentionRows.length > 0 && (
        <>
          <SectionHeader label={t("sidebar.mentions")} />
          {mentionRows.slice(0, 8).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => {
                if (m.channel_id) navigate(`/w/${params.workspaceId}/c/${m.channel_id}`);
              }}
              className="flex flex-col items-start rounded px-2 py-1 text-left text-xs text-amber-300 hover:bg-slate-800"
            >
              <span className="truncate">
                {t("sidebar.mentionInChannel", { channel: channelLabel(channels[m.channel_id ?? ""]) })}
              </span>
              {m.body && <span className="truncate text-slate-500">{m.body}</span>}
            </button>
          ))}
        </>
      )}

      {draftRows.length > 0 && (
        <>
          <SectionHeader label={t("sidebar.drafts")} />
          {draftRows.map((d) => (
            <Link
              key={d.id}
              to={`/w/${params.workspaceId}/c/${d.id}`}
              className="flex flex-col rounded px-2 py-1 text-xs text-slate-300 hover:bg-slate-800"
            >
              <span className="truncate">#{channelLabel(channels[d.id])}</span>
              <span className="truncate text-slate-500">{d.content}</span>
            </Link>
          ))}
        </>
      )}

      {createOpen && <ChannelCreateModal onClose={() => setCreateOpen(false)} />}
      {newDmOpen && <NewDmModal onClose={() => setNewDmOpen(false)} />}
    </aside>
  );
}

function SectionHeader({
  label,
  action,
}: {
  label: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-2 flex items-center justify-between px-2 py-1 text-xs uppercase tracking-wide text-slate-500">
      <span>{label}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded px-1 text-slate-500 hover:bg-slate-800 hover:text-slate-200"
          aria-label={action.label}
        >
          ＋
        </button>
      )}
    </div>
  );
}

function ChannelRow({
  channel,
  to,
  active,
  unread,
}: {
  channel: Channel;
  to: string;
  active: boolean;
  unread?: { unread: number; mentions: number };
}) {
  const hasUnread = (unread?.unread ?? 0) > 0;
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-sm ${
        active
          ? "bg-slate-800 text-collab-teal-300"
          : hasUnread
          ? "text-slate-100 hover:bg-slate-800"
          : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChannelIcon kind={channel.private ? "private" : "public"} />
        <span className={`truncate ${hasUnread ? "font-semibold" : ""}`}>{channel.name}</span>
      </span>
      {(unread?.mentions ?? 0) > 0 ? (
        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {unread!.mentions}
        </span>
      ) : hasUnread ? (
        <span className="rounded-full bg-slate-600 px-1.5 py-0.5 text-[10px] text-white">
          {unread!.unread}
        </span>
      ) : null}
    </Link>
  );
}

function DmRow({
  channel,
  to,
  active,
  unread,
}: {
  channel: Channel;
  to: string;
  active: boolean;
  unread?: { unread: number; mentions: number };
}) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const presence = useSync((s) => s.presence);
  // DM channel name in the seed is currently the slug; we don't know
  // the partner without member lookup, so render the channel name and
  // let the header refine it.
  const partnerId = channel.name.includes(":")
    ? channel.name.split(":").find((p) => p !== me) ?? channel.name
    : channel.name;
  const partnerName = useDisplayName(partnerId);
  const status = mapPresence(presence[partnerId]);
  const hasUnread = (unread?.unread ?? 0) > 0;
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-2 rounded px-2 py-1 text-sm ${
        active ? "bg-slate-800 text-collab-teal-300" : "text-slate-300 hover:bg-slate-800"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="relative">
          <Avatar name={partnerName || partnerId} kind="human" size={20} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={status} />
          </span>
        </span>
        <span className={`truncate ${hasUnread ? "font-semibold" : ""}`}>
          {partnerName || partnerId}
        </span>
      </span>
      {hasUnread && (
        <span className="rounded-full bg-rose-500 px-1.5 py-0.5 text-[10px] font-bold text-white">
          {unread!.unread}
        </span>
      )}
    </Link>
  );
}

function channelLabel(c: Channel | undefined): string {
  if (!c) return "channel";
  return c.name;
}

function mapPresence(s: PresenceStatus | undefined): DotStatus {
  switch (s) {
    case "active":
      return "online";
    case "away":
      return "idle";
    case "dnd":
      return "dnd";
    default:
      return "offline";
  }
}
