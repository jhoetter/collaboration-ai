/**
 * Slack-style left rail.
 *
 * Sections (collapsible, persisted to localStorage):
 *  - Channels (public + private the user joined, archived hidden)
 *  - Direct Messages (DMs + group DMs, presence dots inline, group cluster)
 *  - Mentions (unread mention notifications)
 *  - Drafts (channels with persisted drafts)
 *
 * Below the channel/DM lists sit Slack-style trigger buttons that
 * toggle floating panels (see `SidebarPanel.tsx`):
 *  - Activity (notifications inbox)
 *  - Later     (messages saved for later — formerly "starred")
 *  - Files     (every attachment shared in any visible channel)
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
  IconChevronDown,
  IconChevronRight,
  IconClock,
  IconClose,
  IconFile,
  PresenceDot,
  type PresenceStatus as DotStatus,
} from "@collabai/ui";
import { useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Channel, type PresenceStatus } from "../state/sync.ts";
import { useUi, type SectionId, type SidebarPanelId } from "../state/ui.ts";
import { ChannelCreateModal } from "./ChannelCreateModal.tsx";
import { NewDmModal } from "./NewDmModal.tsx";
import { UserMenu } from "./UserMenu.tsx";

export function Sidebar() {
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  const channels = useSync((s) => s.channels);
  const messageById = useSync((s) => s.messageById);
  const unreadByChannel = useSync((s) => s.unreadByChannel);
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
  const setSidebarOpen = useUi((s) => s.setSidebarOpen);
  const openSidebarPanel = useUi((s) => s.openSidebarPanel);
  const toggleSidebarPanel = useUi((s) => s.toggleSidebarPanel);
  const setNotificationRead = useSync((s) => s.setNotificationRead);

  const mutePrefs = me ? (notificationPrefByChannel[me] ?? {}) : {};
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

  // Unread counts are sourced from the sync store, which itself is
  // hydrated from the server's `unread:by-channel` projection on
  // workspace mount and then patched live by `applyMany`. We only
  // overlay un-acked mention notifications on top so a channel with a
  // dangling activity-feed mention still shows the warning badge.
  const unreadDisplay = useMemo(() => {
    const out: Record<string, { unread: number; mentions: number }> = {};
    for (const channelId of Object.keys(channels)) {
      const tally = unreadByChannel[channelId];
      out[channelId] = {
        unread: tally?.unread ?? 0,
        mentions: tally?.mentions ?? 0,
      };
    }
    for (const n of Object.values(notifications)) {
      if (n.read || n.kind !== "mention" || !n.channel_id) continue;
      if (!out[n.channel_id]) out[n.channel_id] = { unread: 0, mentions: 0 };
      // The server projection already counts mentions, but a freshly
      // delivered mention notification might race ahead of the next
      // hydrate; keep the badge sticky by taking the max.
      out[n.channel_id].mentions = Math.max(out[n.channel_id].mentions, 1);
    }
    return out;
  }, [channels, unreadByChannel, notifications]);

  const mentionRows = useMemo(
    () => Object.values(notifications).filter((n) => !n.read && n.kind === "mention"),
    [notifications]
  );

  const draftRows = useMemo(
    () =>
      Object.entries(draftsByChannel)
        .filter(([, v]) => Boolean(v.content?.trim()))
        .map(([id, v]) => ({ id, content: v.content })),
    [draftsByChannel]
  );

  const savedIds = me ? (starsByUser[me] ?? []) : [];
  const savedCount = useMemo(
    () => savedIds.filter((id) => Boolean(messageById[id])).length,
    [savedIds, messageById]
  );

  const filesCount = useMemo(() => {
    let n = 0;
    for (const m of Object.values(messageById)) {
      if (m.redacted) continue;
      for (const a of m.attachments ?? []) {
        if (a.kind !== "link_preview") n++;
      }
    }
    return n;
  }, [messageById]);

  const totalUnreadActivity = mentionRows.length;

  return (
    <aside className="flex h-full w-full flex-col gap-0.5 overflow-y-auto border-r border-border bg-surface p-2">
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <UserMenu />
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          aria-label={t("common.close")}
          className="-mr-1 inline-flex h-9 w-9 flex-none items-center justify-center rounded-md text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:hidden"
        >
          <IconClose size={16} />
        </button>
      </div>

      <SectionHeader
        id="channels"
        label={t("sidebar.channels")}
        open={sectionsOpen.channels}
        onToggle={() => toggleSection("channels")}
        action={{ label: t("sidebar.addChannel"), onClick: () => setCreateOpen(true) }}
      />
      {sectionsOpen.channels && (
        <>
          {rooms.length === 0 && <p className="px-2 py-1 text-xs text-tertiary">{t("sidebar.noChannels")}</p>}
          {rooms.map((c) => (
            <ChannelRow
              key={c.id}
              channel={c}
              to={`/w/${params.workspaceId}/c/${c.id}`}
              active={params.channelId === c.id}
              unread={unreadDisplay[c.id]}
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
          {dms.length === 0 && <p className="px-2 py-1 text-xs text-tertiary">{t("sidebar.noDms")}</p>}
          {dms.map((c) => (
            <DmRow
              key={c.id}
              channel={c}
              to={`/w/${params.workspaceId}/c/${c.id}`}
              active={params.channelId === c.id}
              unread={unreadDisplay[c.id]}
              muted={isMuted(c.id)}
            />
          ))}
        </>
      )}

      <div className="mt-3 flex flex-col gap-0.5 border-t border-border pt-2">
        <PanelTrigger
          panel="activity"
          icon={<IconActivity size={14} />}
          label={t("sidebar.activity")}
          badge={totalUnreadActivity}
          active={openSidebarPanel === "activity"}
          onToggle={() => toggleSidebarPanel("activity")}
        />
        <PanelTrigger
          panel="later"
          icon={<IconClock size={14} />}
          label={t("sidebar.later")}
          badge={savedCount}
          badgeTone="muted"
          active={openSidebarPanel === "later"}
          onToggle={() => toggleSidebarPanel("later")}
        />
        <PanelTrigger
          panel="files"
          icon={<IconFile size={14} />}
          label={t("sidebar.files")}
          badge={filesCount}
          badgeTone="muted"
          active={openSidebarPanel === "files"}
          onToggle={() => toggleSidebarPanel("files")}
        />
      </div>

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
                  // Optimistically clear the badge, then mirror to the server
                  // so it stays cleared across reloads / other tabs.
                  setNotificationRead(m.id);
                  void callFunction("notifications:mark-read", {
                    notification_id: m.id,
                  }).catch(() => undefined);
                  if (m.channel_id) {
                    const anchor = m.target_event_id ? `#message-${m.target_event_id}` : "";
                    navigate(`/w/${params.workspaceId}/c/${m.channel_id}${anchor}`);
                  }
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

function PanelTrigger({
  panel,
  icon,
  label,
  badge,
  badgeTone = "alert",
  active,
  onToggle,
}: {
  panel: SidebarPanelId;
  icon: React.ReactNode;
  label: string;
  badge: number;
  badgeTone?: "alert" | "muted";
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      data-sidebar-panel-trigger={panel}
      aria-pressed={active}
      className={`flex w-full items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150 lg:py-1.5 ${
        active
          ? "bg-accent font-medium text-accent-foreground hover:bg-accent/90"
          : "text-secondary hover:bg-hover hover:text-foreground"
      }`}
    >
      <span className="flex items-center gap-2">
        {icon}
        {label}
      </span>
      {badge > 0 && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active
              ? "bg-accent-foreground/20 text-accent-foreground"
              : badgeTone === "alert"
                ? "bg-destructive text-destructive-foreground"
                : "bg-tertiary/70 text-background"
          }`}
        >
          {badge}
        </span>
      )}
    </button>
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
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150 lg:py-1.5 ${dim} ${
        active
          ? "bg-accent font-medium text-accent-foreground hover:bg-accent/90"
          : hasUnread
            ? "text-foreground hover:bg-hover"
            : "text-secondary hover:bg-hover hover:text-foreground"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <ChannelIcon kind={channel.private ? "private" : "public"} />
        <span className={`truncate ${hasUnread || active ? "font-semibold" : ""}`}>{channel.name}</span>
      </span>
      {(unread?.mentions ?? 0) > 0 && !muted ? (
        <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
          {unread!.mentions}
        </span>
      ) : hasUnread ? (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] ${
            active ? "bg-accent-foreground/20 text-accent-foreground" : "bg-tertiary/70 text-background"
          }`}
        >
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

  // Prefer the canonical member list returned by `channel:list` for DMs.
  // Older channels with no `members` array still fall back to parsing the
  // channel name (legacy `userA:userB` slug).
  const memberIds =
    channel.members && channel.members.length > 0
      ? channel.members.filter((p) => p && p !== me)
      : channel.name.includes(":")
        ? channel.name.split(":").filter((p) => p && p !== me)
        : [];

  // A DM is a "group" if the backend tagged it as such OR there is more
  // than one peer (handles legacy 3+ DMs that were created before the
  // backend started tagging multi-party DMs as `group_dm`).
  const isGroup = channel.type === "group_dm" || memberIds.length > 1;

  if (isGroup) {
    const ids = memberIds.length > 0 ? memberIds : [channel.name];
    return (
      <Link
        to={to}
        aria-current={active ? "page" : undefined}
        className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150 lg:py-1.5 ${dim} ${
          active
            ? "bg-accent font-medium text-accent-foreground hover:bg-accent/90"
            : "text-secondary hover:bg-hover hover:text-foreground"
        }`}
      >
        <span className="flex min-w-0 items-center gap-2">
          <GroupAvatarCluster ids={ids.slice(0, 3)} />
          <GroupDmLabel ids={ids} hasUnread={hasUnread || active} />
        </span>
        {hasUnread && (
          <span className="rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-bold text-destructive-foreground">
            {unread!.unread}
          </span>
        )}
      </Link>
    );
  }

  // Single-DM partner — first non-self member, or fall back to legacy parsing,
  // and finally to a polite "Direct message" label so we never display the
  // raw `dm_xxxx` slug to end users.
  const partnerId =
    memberIds[0] ??
    (channel.name.includes(":") ? (channel.name.split(":").find((p) => p !== me) ?? null) : null);
  return (
    <DmRowSingle
      to={to}
      active={active}
      muted={muted}
      unread={unread}
      partnerId={partnerId}
      dim={dim}
      hasUnread={hasUnread}
      presence={presence}
    />
  );
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
  partnerId: string | null;
  dim: string;
  hasUnread: boolean;
  presence: Record<string, PresenceStatus>;
}) {
  const { t } = useTranslator();
  const partnerName = useDisplayName(partnerId ?? "");
  const status = partnerId ? mapPresence(presence[partnerId]) : "offline";
  const label = partnerName || (partnerId ? partnerId : t("sidebar.directMessage"));
  return (
    <Link
      to={to}
      aria-current={active ? "page" : undefined}
      className={`flex items-center justify-between gap-2 rounded-md px-2 py-2 text-sm transition-colors duration-150 lg:py-1.5 ${dim} ${
        active
          ? "bg-accent font-medium text-accent-foreground hover:bg-accent/90"
          : "text-secondary hover:bg-hover hover:text-foreground"
      }`}
    >
      <span className="flex min-w-0 items-center gap-2">
        <span className="relative">
          <Avatar name={label} kind="human" size={20} />
          {partnerId && (
            <span className="absolute -bottom-0.5 -right-0.5">
              <PresenceDot status={status} />
            </span>
          )}
        </span>
        <span className={`truncate ${hasUnread && !active ? "font-semibold text-foreground" : ""}`}>
          {label}
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
        <span key={id} className={i === 0 ? "" : "-ml-2 ring-2 ring-surface rounded-full"}>
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
