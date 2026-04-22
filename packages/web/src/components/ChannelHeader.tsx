/**
 * Slack-style channel header — name, topic, member stack, and the
 * "Start huddle" / "Search in channel" actions.
 *
 * For DMs we render the partner's display name + presence dot rather
 * than the channel slug.
 */
import { Avatar, ChannelIcon, PresenceDot, Button, type PresenceStatus as DotStatus } from "@collabai/ui";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { type Channel, useSync, type PresenceStatus } from "../state/sync.ts";
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
  const { t } = useTranslator();
  const [showSettings, setShowSettings] = useState(false);
  const [showHuddle, setShowHuddle] = useState(false);

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
    <header className="flex items-center justify-between gap-3 border-b border-slate-800 bg-slate-900 px-4 py-2">
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
              <h1 className="truncate text-sm font-semibold text-slate-100">
                {partner.display_name}
              </h1>
              <p className="truncate text-xs text-slate-500">Direct message</p>
            </div>
          </>
        ) : (
          <>
            <ChannelIcon kind={channel?.private ? "private" : "public"} />
            <div className="min-w-0">
              <h1 className="truncate text-sm font-semibold text-slate-100">
                {channel?.name ?? channelId}
                {channel?.archived && (
                  <span className="ml-2 text-xs text-amber-400">archived</span>
                )}
              </h1>
              {channel?.topic && (
                <p className="truncate text-xs text-slate-500">{channel.topic}</p>
              )}
            </div>
          </>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!isDm && members.length > 0 && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center -space-x-2"
            aria-label={`${members.length} members`}
          >
            {members.slice(0, 4).map((m) => (
              <span key={m.user_id} className="ring-2 ring-slate-900">
                <Avatar name={m.display_name} kind="human" size={24} />
              </span>
            ))}
            {members.length > 4 && (
              <span className="ml-1 rounded-full bg-slate-800 px-2 py-0.5 text-[11px] text-slate-300">
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
        {!isDm && (
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Channel settings"
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

function HeaderTopic({ channelId }: { channelId: string }) {
  return null; // placeholder for future inline topic editing
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
