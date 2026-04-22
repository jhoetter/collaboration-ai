/**
 * Slack-style left rail.
 *
 * Sections (collapsible, persisted to localStorage):
 *  - Channels (public + private the user joined, archived hidden)
 *  - Direct Messages (DMs + group DMs, presence dots inline, group cluster)
 *  - Saved (starred messages — Phase 3)
 *  - Mentions (unread mention notifications)
 *  - Drafts (channels with persisted drafts)
 *
 * Each channel row shows its unread + mention badge, derived from
 * `notifications`, `notificationPrefByChannel` and `readUpToByChannel`
 * slices of the sync store. Muted channels render dim and skip the
 * unread-bold treatment per Slack.
 */
import {
  Avatar,
  ChannelIcon,
  IconActivity,
  IconBookmark,
  IconChevronDown,
  IconChevronRight,
  PresenceDot,
  type PresenceStatus as DotStatus,
} from "@collabai/ui";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Channel, type PresenceStatus } from "../state/sync.ts";
import { useUi, type SectionId } from "../state/ui.ts";
import { ChannelCreateModal } from "./ChannelCreateModal.tsx";
import { NewDmModal } from "./NewDmModal.tsx";
import { UserMenu } from "./UserMenu.tsx";

export function Sidebar() {
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  const channels = useSync((s) => s.channels);
  const messagesByChannel = useSync((s) => s.messagesByChannel);
  const messageById = useSync((s) => s.messageById);
  const readUpToByChannel = useSync((s) => s.readUpToByChannel);
  const notifications = useSync((s) => s.notifications);
  const draftsByChannel = useSync((s) => s.draftsByChannel);
  const notificationPrefByChannel = useSync((s) => s.notificationPrefByChannel);
  const starsByUser = useSync((s) => s.starsByUser);
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const navigate = useNavigate();
  const { t } = useTranslator();
  const createOpen = useUi((s) => s.createChannelOpen);
  const newDmOpen = useUi((s) => s.newDmOpen);
  const setCreateOpen = useUi((s) => s.setCreateChannelOpen);
  const setNewDmOpen = useUi((s) => s.setNewDmOpen);
  const sectionsOpen = useUi((s) => s.sectionsOpen);
  const toggleSection = useUi((s) => s.toggleSection);

  const mutePrefs = me ? notificationPrefByChannel[me] ?? {} : {};
  const isMuted = (cid: string) => mutePrefs[cid] === "none";

  const { rooms, dms } = useMemo(() => {
    const rooms: Channel[] = [];
    const dms: Channel[] = [];
    for (const c of Object.values(channels)) {
      if (c.archived) continue;
      if (c.type === "dm" || c.type === "group_dm") dms.push(c);
      else rooms.push(c);
    }
    rooms.sort((a, b) => a.name.localeCompare(b.name));
    dms.sort((a, b) => a.name.localeCompare(b.name));
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

  const savedIds = me ? starsByUser[me] ?? [] : [];
  const savedRows = useMemo(
    () =>
      savedIds
        .map((id) => messageById[id])
        .filter((m): m is NonNullable<typeof m> => Boolean(m)),
    [savedIds, messageById],
  );

  const totalUnreadActivity = mentionRows.length;

  return (
    <aside className="flex w-64 flex-col gap-0.5 border-r border-border bg-surface p-2">
      <UserMenu />

      <Link
        to={`/w/${params.workspaceId}/activity`}
        className="mt-2 flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm text-secondary transition-colors duration-150 hover:bg-hover hover:text-foreground"
      >
        <span className="flex items-center gap-2">
          <IconActivity size={14} />
          {t("sidebar.activity")}
        </span>
        {totalUnreadActivity > 0 && (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
            {totalUnreadActivity}
          </span>
        )}
      </Link>

      <SectionHeader
        id="channels"
        label={t("sidebar.channels")}
        open={sectionsOpen.channels}
        onToggle={() => toggleSection("channels")}
        action={{ label: t("sidebar.addChannel"), onClick: () => setCreateOpen(true) }}
      />
      {sectionsOpen.channels && (
        <>
          {rooms.length === 0 && (
            <p className="px-2 py-1 text-xs text-tertiary">{t("sidebar.noChannels")}</p>
          )}
          {rooms.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              to={`/w/${params.workspaceId}/c/${c.id}`}
              active={params.channelId === c.id}
              unread={unreadByChannel[c.id]}
              muted={isMuted(c.id)}
            />
          ))}
        </>
      )}

      <SectionHeader
        id="dms"
        label={t("sidebar.directMessages")}
        open={sectionsOpen.dms}
        onToggle={() => toggleSection("dms")}
        action={{ label: t("sidebar.newDm"), onClick: () => setNewDmOpen(true) }}
      />
      {sectionsOpen.dms && (
        <>
          {dms.length === 0 && (
            <p className="px-2 py-1 text-xs text-tertiary">{t("sidebar.noDms")}</p>
          )}
          {dms.map((c) => (
            <DmRow
              key={c.id}
              channel={c}
              to={`/w/${params.workspaceId}/c/${c.id}`}
              active={params.channelId === c.id}
              unread={unreadByChannel[c.id]}
              muted={isMuted(c.id)}
            />
          ))}
        </>
      )}

      {savedRows.length > 0 && (
        <>
          <SectionHeader
            id="saved"
            label={t("sidebar.saved")}
            open={sectionsOpen.saved}
            onToggle={() => toggleSection("saved")}
          />
          {sectionsOpen.saved &&
            savedRows.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() =>
                  navigate(`/w/${params.workspaceId}/c/${m.channel_id}#message-${m.id}`)
                }
                className="flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-xs text-secondary transition-colors duration-150 hover:bg-hover"
              >
                <IconBookmark
                  size={12}
                  fill="currentColor"
                  className="mt-0.5 flex-none text-accent"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-foreground">
                    #{channelLabel(channels[m.channel_id])}
                  </span>
                  <span className="block truncate text-tertiary">{m.content}</span>
                </span>
              </button>
            ))}
        </>
      )}

      {mentionRows.length > 0 && (
        <>
          <SectionHeader
            id="mentions"
            label={t("sidebar.mentions")}
            open={sectionsOpen.mentions}
            onToggle={() => toggleSection("mentions")}
          />
          {sectionsOpen.mentions &&
            mentionRows.slice(0, 8).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => {
                  if (m.channel_id) navigate(`/w/${params.workspaceId}/c/${m.channel_id}`);
                }}
                className="flex flex-col items-start rounded-md px-2 py-1.5 text-left text-xs text-warning transition-colors duration-150 hover:bg-hover"
              >
                <span className="truncate">
                  {t("sidebar.mentionInChannel", { channel: channelLabel(channels[m.channel_id ?? ""]) })}
                </span>
                {m.body && <span className="truncate text-tertiary">{m.body}</span>}
              </button>
            ))}
        </>
      )}

      {draftRows.length > 0 && (
        <>
          <SectionHeader
            id="drafts"
            label={t("sidebar.drafts")}
            open={sectionsOpen.drafts}
            onToggle={() => toggleSection("drafts")}
          />
          {sectionsOpen.drafts &&
            draftRows.map((d) => (
              <Link
                key={d.id}
                to={`/w/${params.workspaceId}/c/${d.id}`}
                className="flex flex-col rounded-md px-2 py-1.5 text-xs text-secondary transition-colors duration-150 hover:bg-hover"
              >
                <span className="truncate">#{channelLabel(channels[d.id])}</span>
                <span className="truncate text-tertiary">{d.content}</span>
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
  id,
  label,
  open,
  onToggle,
  action,
}: {
  id: SectionId;
  label: string;
  open: boolean;
  onToggle: () => void;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mt-3 flex items-center justify-between px-1 py-1 text-[11px] font-semibold uppercase tracking-wider text-tertiary">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={`section-${id}`}
        className="inline-flex items-center gap-1 rounded-md px-1 py-0.5 text-tertiary transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {open ? <IconChevronDown size={10} /> : <IconChevronRight size={10} />}
        <span>{label}</span>
      </button>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="rounded-md px-1.5 text-tertiary transition-colors duration-150 hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
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
  muted,
}: {
  channel: Channel;
  to: string;
  active: boolean;
  unread?: { unread: number; mentions: number };
  muted: boolean;
}) {
  const hasUnread = !muted && (unread?.unread ?? 0) > 0;
  const dim = muted ? "opacity-60" : "";
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${dim} ${
        active
          ? "bg-accent-light text-accent"
          : hasUnread
          ? "text-foreground hover:bg-hover"
          : "text-secondary hover:bg-hover hover:text-foreground"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChannelIcon kind={channel.private ? "private" : "public"} />
        <span className={`truncate ${hasUnread ? "font-semibold" : ""}`}>{channel.name}</span>
      </span>
      {(unread?.mentions ?? 0) > 0 && !muted ? (
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
          {unread!.mentions}
        </span>
      ) : hasUnread ? (
        <span className="rounded-full bg-tertiary/70 px-1.5 py-0.5 text-[10px] text-background">
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
  muted,
}: {
  channel: Channel;
  to: string;
  active: boolean;
  unread?: { unread: number; mentions: number };
  muted: boolean;
}) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const presence = useSync((s) => s.presence);
  const hasUnread = !muted && (unread?.unread ?? 0) > 0;
  const dim = muted ? "opacity-60" : "";
  const isGroup = channel.type === "group_dm";

  if (isGroup) {
    const ids = channel.name.includes(":")
      ? channel.name.split(":").filter((p) => p && p !== me)
      : [channel.name];
    return (
      <Link
        to={to}
        className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${dim} ${
          active
            ? "bg-accent-light text-accent"
            : "text-secondary hover:bg-hover hover:text-foreground"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GroupAvatarCluster ids={ids.slice(0, 3)} />
          <GroupDmLabel ids={ids} hasUnread={hasUnread} />
        </span>
        {hasUnread && (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
            {unread!.unread}
          </span>
        )}
      </Link>
    );
  }

  const partnerId = channel.name.includes(":")
    ? channel.name.split(":").find((p) => p !== me) ?? channel.name
    : channel.name;
  return <DmRowSingle to={to} active={active} muted={muted} unread={unread} partnerId={partnerId} dim={dim} hasUnread={hasUnread} presence={presence} />;
}

function DmRowSingle({
  to,
  active,
  unread,
  partnerId,
  dim,
  hasUnread,
  presence,
}: {
  to: string;
  active: boolean;
  muted: boolean;
  unread?: { unread: number; mentions: number };
  partnerId: string;
  dim: string;
  hasUnread: boolean;
  presence: Record<string, PresenceStatus>;
}) {
  const partnerName = useDisplayName(partnerId);
  const status = mapPresence(presence[partnerId]);
  return (
    <Link
      to={to}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-sm transition-colors duration-150 ${dim} ${
        active
          ? "bg-accent-light text-accent"
          : "text-secondary hover:bg-hover hover:text-foreground"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="relative">
          <Avatar name={partnerName || partnerId} kind="human" size={20} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={status} />
          </span>
        </span>
        <span className={`truncate ${hasUnread ? "font-semibold text-foreground" : ""}`}>
          {partnerName || partnerId}
        </span>
      </span>
      {hasUnread && (
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
          {unread!.unread}
        </span>
      )}
    </Link>
  );
}

function GroupAvatarCluster({ ids }: { ids: string[] }) {
  return (
    <span className="relative inline-flex">
      {ids.slice(0, 2).map((id, i) => (
        <span
          key={id}
          className={i === 0 ? "" : "-ml-2 ring-2 ring-surface rounded-full"}
        >
          <ClusterAvatar id={id} />
        </span>
      ))}
    </span>
  );
}

function ClusterAvatar({ id }: { id: string }) {
  const name = useDisplayName(id);
  return <Avatar name={name || id} kind="human" size={20} />;
}

function GroupDmLabel({ ids, hasUnread }: { ids: string[]; hasUnread: boolean }) {
  const display = ids.slice(0, 3).map((id) => <NameOf key={id} id={id} />);
  const more = ids.length > 3 ? ` +${ids.length - 3}` : "";
  return (
    <span className={`min-w-0 truncate ${hasUnread ? "font-semibold text-foreground" : ""}`}>
      {display.map((node, i) => (
        <span key={i}>
          {i > 0 && ", "}
          {node}
        </span>
      ))}
      {more}
    </span>
  );
}

function NameOf({ id }: { id: string }) {
  const name = useDisplayName(id);
  return <>{name || id}</>;
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
