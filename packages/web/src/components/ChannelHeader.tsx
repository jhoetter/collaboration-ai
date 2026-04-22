/**
 * Slack-style channel header — name, topic, member stack, and the
 * "Start huddle" / "Search in channel" actions.
 *
 * For DMs we render the partner's display name + presence dot rather
 * than the channel slug.
 */
import {
  Avatar,
  Button,
  ChannelIcon,
  IconBell,
  IconBellOff,
  IconChevronDown,
  IconCheck,
  IconLogOut,
  IconMore,
  IconPencil,
  IconSearch,
  IconUsers,
  IconVideo,
  PresenceDot,
  type PresenceStatus as DotStatus,
} from "@collabai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useDialogs } from "../lib/dialogs.tsx";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { type Channel, type NotificationPref, useSync, type PresenceStatus } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { ChannelDetailPanel, type DetailTab } from "./ChannelDetailPanel.tsx";
import { HuddlePanel } from "./HuddlePanel.tsx";

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
}

export function ChannelHeader({
  channelId,
  channel,
}: {
  channelId: string;
  channel: Channel | undefined;
}) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const huddle = useSync((s) => s.huddlesByChannel[channelId]);
  const presence = useSync((s) => s.presence);
  const notificationPrefByChannel = useSync((s) => s.notificationPrefByChannel);
  const setMembersOpen = useUi((s) => s.setMembersPanelOpen);
  const setSearchQuery = useUi((s) => s.setSearchQuery);
  const { t } = useTranslator();
  const { confirm } = useDialogs();
  const [detailTab, setDetailTab] = useState<DetailTab | null>(null);
  const [showHuddle, setShowHuddle] = useState(false);
  const navigate = useNavigate();
  const params = useParams<{ workspaceId: string }>();
  const qc = useQueryClient();
  const pref: NotificationPref =
    (me ? notificationPrefByChannel[me]?.[channelId] : undefined) ?? "all";

  const { data: members = [] } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => callFunction<MemberRow[]>("channel:list-members", { channel_id: channelId }),
    enabled: !!channelId,
    refetchOnWindowFocus: false,
  });

  const isDm = channel?.type === "dm" || channel?.type === "group_dm";
  const dmPeers = isDm ? members.filter((m) => m.user_id !== me) : [];
  const isGroupDm = isDm && (channel?.type === "group_dm" || dmPeers.length > 1);
  const partner = isDm && !isGroupDm ? dmPeers[0] : undefined;
  const partnerStatus = partner ? mapPresence(presence[partner.user_id]) : "offline";

  async function startHuddle() {
    try {
      await callFunction("huddle:start", { channel_id: channelId });
    } catch (err) {
      console.error("huddle start failed", err);
    }
    setShowHuddle(true);
  }

  async function leaveChannel() {
    if (!channel) return;
    const ok = await confirm({
      title: t("dialogs.leaveChannelTitle"),
      description: t("members.leaveConfirm", { channel: channel.name ?? channelId }),
      confirmLabel: t("members.leaveChannel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await callFunction("channel:leave", { channel_id: channelId });
      await qc.invalidateQueries({ queryKey: ["channel-members", channelId] });
      navigate(`/w/${params.workspaceId}`);
    } catch (err) {
      console.error("channel:leave", err);
    }
  }

  function openDetail(tab: DetailTab = "about") {
    setDetailTab(tab);
  }

  function searchInChannel() {
    const name = channel?.name ?? channelId;
    setSearchQuery(`in:#${name} `);
  }

  return (
    <header className="flex items-center justify-between gap-2 border-b border-border bg-surface px-2 py-2 sm:gap-3 lg:px-4 lg:py-3">
      <button
        type="button"
        onClick={() => openDetail("about")}
        title={t("channelHeader.openDetail")}
        className="group flex min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 py-1 -ml-1.5 text-left transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {isGroupDm ? (
          <>
            <GroupDmAvatarStack peers={dmPeers} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">
                {formatGroupDmTitle(dmPeers)}
              </h1>
              <p className="truncate text-xs text-tertiary">
                {t("channelHeader.groupDirectMessage", { n: dmPeers.length + 1 })}
              </p>
            </div>
          </>
        ) : isDm && partner ? (
          <>
            <div className="relative">
              <Avatar name={partner.display_name} kind="human" size={28} />
              <span className="absolute -bottom-0.5 -right-0.5">
                <PresenceDot status={partnerStatus} />
              </span>
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">
                {partner.display_name}
              </h1>
              <p className="truncate text-xs text-tertiary">{t("channelHeader.directMessage")}</p>
            </div>
          </>
        ) : (
          <>
            <ChannelIcon kind={channel?.private ? "private" : "public"} />
            <div className="min-w-0">
              <h1 className="flex items-center gap-1 truncate text-sm font-semibold text-foreground">
                <span className="truncate">{channel?.name ?? channelId}</span>
                {channel?.archived && (
                  <span className="ml-1 text-xs text-warning">{t("channelHeader.archivedTag")}</span>
                )}
                <IconChevronDown
                  size={12}
                  className="text-tertiary opacity-0 transition-opacity group-hover:opacity-100"
                />
              </h1>
              {channel?.topic && (
                <p className="truncate text-xs text-tertiary">{channel.topic}</p>
              )}
            </div>
          </>
        )}
      </button>
      <div className="flex flex-none items-center gap-1">
        {!isDm && (
          <button
            type="button"
            onClick={searchInChannel}
            aria-label={t("channelHeader.searchInChannel")}
            title={t("channelHeader.searchInChannel")}
            className="hidden rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:inline-flex"
          >
            <IconSearch size={14} />
          </button>
        )}
        {!isDm && members.length > 0 && (
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            className="mr-1 hidden items-center gap-1.5 rounded-md px-1 py-0.5 transition-colors hover:bg-hover md:inline-flex"
            aria-label={`${members.length} members`}
            title={t("members.title")}
          >
            <span className="flex items-center -space-x-1.5">
              {members.slice(0, 3).map((m) => (
                <span key={m.user_id} className="rounded-full ring-2 ring-surface">
                  <Avatar name={m.display_name} kind="human" size={20} />
                </span>
              ))}
            </span>
            <span className="text-xs text-secondary tabular-nums">
              {members.length.toLocaleString()}
            </span>
          </button>
        )}
        {huddle ? (
          <Button variant="primary" size="sm" onClick={() => setShowHuddle(true)} className="gap-1.5">
            <IconVideo size={14} />
            <span className="hidden sm:inline">
              {t("channel.joinHuddle", { n: huddle.participants.length })}
            </span>
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => void startHuddle()}
            aria-label={t("channel.startHuddle")}
            title={t("channel.startHuddle")}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-secondary transition-colors hover:bg-hover hover:text-foreground"
          >
            <IconVideo size={14} />
            <span className="hidden sm:inline">{t("channel.startHuddle")}</span>
          </button>
        )}
        <span className="mx-1 hidden h-5 w-px bg-border sm:block" aria-hidden />
        <NotificationMenu channelId={channelId} pref={pref} />
        {!isDm && (
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            aria-label={t("members.title")}
            title={t("members.title")}
            className="hidden rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 md:inline-flex"
          >
            <IconUsers size={14} />
          </button>
        )}
        <ChannelKebab
          isDm={isDm}
          onSettings={() => openDetail("about")}
          onLeave={() => void leaveChannel()}
          onSearch={!isDm ? searchInChannel : undefined}
          onMembers={!isDm ? () => setMembersOpen(true) : undefined}
          memberCount={members.length}
        />
      </div>
      {detailTab && channel && (
        <ChannelDetailPanel
          channel={channel}
          members={members}
          initialTab={detailTab}
          onClose={() => setDetailTab(null)}
        />
      )}
      {showHuddle && (
        <HuddlePanel channelId={channelId} onClose={() => setShowHuddle(false)} />
      )}
    </header>
  );
}

function NotificationMenu({
  channelId,
  pref,
}: {
  channelId: string;
  pref: NotificationPref;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslator();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function setPref(next: NotificationPref) {
    setOpen(false);
    try {
      await callFunction("chat:set-notification-pref", {
        channel_id: channelId,
        pref: next,
      });
    } catch (err) {
      console.error("set-notification-pref", err);
    }
  }

  const Icon = pref === "none" ? IconBellOff : IconBell;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("channelHeader.notifications")}
        title={t("channelHeader.notifications")}
        className={`rounded-md p-1.5 transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
          pref === "none" ? "text-warning" : "text-tertiary hover:text-foreground"
        }`}
      >
        <Icon size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-border bg-card shadow-lg"
        >
          <PrefRow
            label={t("channelHeader.notifyAll")}
            active={pref === "all"}
            onClick={() => void setPref("all")}
          />
          <PrefRow
            label={t("channelHeader.notifyMentions")}
            active={pref === "mentions"}
            onClick={() => void setPref("mentions")}
          />
          <PrefRow
            label={t("channelHeader.notifyNone")}
            active={pref === "none"}
            onClick={() => void setPref("none")}
          />
        </div>
      )}
    </div>
  );
}

function PrefRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      onClick={onClick}
      className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-hover"
    >
      <span>{label}</span>
      {active && <IconCheck size={14} className="text-accent" />}
    </button>
  );
}

function ChannelKebab({
  isDm,
  onSettings,
  onLeave,
  onSearch,
  onMembers,
  memberCount,
}: {
  isDm: boolean;
  onSettings: () => void;
  onLeave: () => void;
  onSearch?: () => void;
  onMembers?: () => void;
  memberCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslator();

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("channelHeader.more")}
        title={t("channelHeader.more")}
        className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <IconMore size={14} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-30 mt-1 w-56 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg"
        >
          {onSearch && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSearch();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover md:hidden"
            >
              <IconSearch size={14} className="text-tertiary" />
              {t("channelHeader.searchInChannel")}
            </button>
          )}
          {onMembers && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onMembers();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover md:hidden"
            >
              <IconUsers size={14} className="text-tertiary" />
              {t("members.title")}
              {memberCount !== undefined && memberCount > 0 && (
                <span className="ml-auto text-xs tabular-nums text-tertiary">
                  {memberCount.toLocaleString()}
                </span>
              )}
            </button>
          )}
          {(onSearch || onMembers) && !isDm && (
            <div className="my-1 h-px bg-border md:hidden" />
          )}
          {!isDm && (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSettings();
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
            >
              <IconPencil size={14} className="text-tertiary" />
              {t("channelHeader.settings")}
            </button>
          )}
          {!isDm && (
            <>
              <div className="my-1 h-px bg-border" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onLeave();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-hover"
              >
                <IconLogOut size={14} />
                {t("members.leaveChannel")}
              </button>
            </>
          )}
          {isDm && (
            <p className="px-3 py-2 text-xs text-tertiary">
              {t("channelHeader.dmHint")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupDmAvatarStack({ peers }: { peers: MemberRow[] }) {
  const visible = peers.slice(0, 3);
  return (
    <span className="inline-flex items-center -space-x-2">
      {visible.map((m) => (
        <span key={m.user_id} className="rounded-full ring-2 ring-surface">
          <Avatar name={m.display_name} kind="human" size={28} />
        </span>
      ))}
    </span>
  );
}

function formatGroupDmTitle(peers: MemberRow[]): string {
  const names = peers.map((m) => m.display_name);
  if (names.length <= 3) return names.join(", ");
  return `${names.slice(0, 3).join(", ")} +${names.length - 3}`;
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
