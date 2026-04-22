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
  IconCheck,
  IconUsers,
  PresenceDot,
  type PresenceStatus as DotStatus,
} from "@collabai/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { type Channel, type NotificationPref, useSync, type PresenceStatus } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { ChannelSettingsModal } from "./ChannelSettingsModal.tsx";
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
  const { t } = useTranslator();
  const [showSettings, setShowSettings] = useState(false);
  const [showHuddle, setShowHuddle] = useState(false);
  const pref: NotificationPref =
    (me ? notificationPrefByChannel[me]?.[channelId] : undefined) ?? "all";

  const { data: members = [] } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () => callFunction<MemberRow[]>("channel:list-members", { channel_id: channelId }),
    enabled: !!channelId,
    refetchOnWindowFocus: false,
  });

  const isDm = channel?.type === "dm" || channel?.type === "group_dm";
  const partner = isDm ? members.find((m) => m.user_id !== me) : undefined;
  const partnerStatus = partner ? mapPresence(presence[partner.user_id]) : "offline";

  async function startHuddle() {
    try {
      await callFunction("huddle:start", { channel_id: channelId });
    } catch (err) {
      console.error("huddle start failed", err);
    }
    setShowHuddle(true);
  }

  return (
    <header className="flex items-center justify-between gap-3 border-b border-border bg-surface px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        {isDm && partner ? (
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
              <p className="truncate text-xs text-tertiary">Direct message</p>
            </div>
          </>
        ) : (
          <>
            <ChannelIcon kind={channel?.private ? "private" : "public"} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-foreground">
                {channel?.name ?? channelId}
                {channel?.archived && (
                  <span className="ml-2 text-xs text-warning">archived</span>
                )}
              </h1>
              {channel?.topic && (
                <p className="truncate text-xs text-tertiary">{channel.topic}</p>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!isDm && members.length > 0 && (
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            className="flex items-center -space-x-2"
            aria-label={`${members.length} members`}
          >
            {members.slice(0, 4).map((m) => (
              <span key={m.user_id} className="ring-2 ring-surface">
                <Avatar name={m.display_name} kind="human" size={24} />
              </span>
            ))}
            {members.length > 4 && (
              <span className="ml-1 rounded-full bg-hover px-2 py-0.5 text-[11px] text-secondary">
                +{members.length - 4}
              </span>
            )}
          </button>
        )}
        {huddle ? (
          <Button variant="primary" size="sm" onClick={() => setShowHuddle(true)}>
            {t("channel.joinHuddle", { n: huddle.participants.length })}
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={() => void startHuddle()}>
            {t("channel.startHuddle")}
          </Button>
        )}
        <NotificationMenu channelId={channelId} pref={pref} />
        {!isDm && (
          <button
            type="button"
            onClick={() => setMembersOpen(true)}
            aria-label={t("members.title")}
            title={t("members.title")}
            className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <IconUsers size={14} />
          </button>
        )}
        {!isDm && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded-md p-1.5 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            aria-label={t("channelHeader.settings")}
            title={t("channelHeader.settings")}
          >
            ⚙
          </button>
        )}
      </div>
      {showSettings && channel && (
        <ChannelSettingsModal
          channel={channel}
          members={members}
          onClose={() => setShowSettings(false)}
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
