import { useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";
import { ChannelHeader } from "../components/ChannelHeader.tsx";
import { Composer, type ComposerSendPayload } from "../components/Composer.tsx";
import { DropOverlay } from "../components/DropOverlay.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { TypingIndicator } from "../components/TypingIndicator.tsx";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Message } from "../state/sync.ts";
import { useThread } from "../state/threads.ts";

const EMPTY_MESSAGES: Message[] = [];

interface SendMessageResponse {
  command_id: string;
  status: "applied" | "staged" | "rejected" | "failed";
  events: Array<{
    event_id: string;
    sequence: number;
    sender_id: string;
    sender_type: "human" | "agent" | "system";
    type: string;
    content: Record<string, unknown>;
    room_id: string;
  }>;
  error?: { code: string; message: string };
}

export function ChannelPage() {
  const { channelId } = useParams<{ channelId: string }>();
  const identity = useAuth((s) => s.identity);
  const messages = useSync((s) =>
    channelId ? (s.messagesByChannel[channelId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES
  );
  const channel = useSync((s) => (channelId ? s.channels[channelId] : undefined));
  const applyOptimistic = useSync((s) => s.applyOptimistic);
  const reconcile = useSync((s) => s.reconcileOptimistic);
  const dropOptimistic = useSync((s) => s.dropOptimistic);
  const notifications = useSync((s) => s.notifications);
  const setNotificationRead = useSync((s) => s.setNotificationRead);
  const openThread = useThread((s) => s.open);
  const { t } = useTranslator();

  // Visiting a channel implicitly clears any mention/reply notifications
  // pointing at that channel — same as Slack.  We mirror this to the
  // server so the badge stays cleared across reload / other tabs.
  useEffect(() => {
    if (!channelId) return;
    const stale = Object.values(notifications).filter((n) => !n.read && n.channel_id === channelId);
    if (stale.length === 0) return;
    for (const n of stale) {
      setNotificationRead(n.id);
      void callFunction("notifications:mark-read", {
        notification_id: n.id,
      }).catch(() => undefined);
    }
    // Only react to channel switches and freshly arriving notifications;
    // re-running on every minor change to `notifications` would still be
    // safe but emits redundant requests.
  }, [channelId, notifications, setNotificationRead]);

  // Human-readable composer placeholder. For DMs we resolve the other
  // member's display name so the prompt reads "Message Alex Rivera" instead
  // of "Message #dm_4aa3f3de7188".
  const isDm = channel?.type === "dm" || channel?.type === "group_dm";
  const dmPartnerId = useMemo(() => {
    if (!channel || !isDm) return null;
    const me = identity?.user_id;
    const ids = channel.members?.filter((p) => p && p !== me) ?? [];
    return ids[0] ?? null;
  }, [channel, isDm, identity?.user_id]);
  const partnerName = useDisplayName(dmPartnerId ?? "");
  const composerPlaceholder = isDm
    ? t("composer.messageDm", {
        name: partnerName || t("sidebar.directMessage"),
      })
    : t("composer.messageChannel", { name: channel?.name ?? channelId ?? "" });

  async function handleSend(payload: ComposerSendPayload) {
    if (!channelId) return;
    if (!identity) {
      console.warn("send dropped — no identity yet; bootstrap still running");
      return;
    }
    const localId = `local-${crypto.randomUUID()}`;
    applyOptimistic({
      id: localId,
      channel_id: channelId,
      thread_root: null,
      sender_id: identity.user_id,
      sender_type: "human",
      content: payload.text,
      mentions: payload.mentions,
      attachments: payload.attachments,
      sequence: -1,
      origin_ts: Date.now(),
    });
    try {
      const result = await callFunction<SendMessageResponse>("chat:send-message", {
        channel_id: channelId,
        content: payload.text,
        mentions: payload.mentions,
        attachments: payload.attachments,
      });
      if (result.status !== "applied" || result.events.length === 0) {
        console.error("send rejected", result.error ?? result.status);
        dropOptimistic(channelId, localId);
        return;
      }
      const event = result.events[0];
      reconcile(localId, {
        id: event.event_id,
        channel_id: channelId,
        thread_root: null,
        sender_id: event.sender_id,
        sender_type: event.sender_type,
        content: payload.text,
        mentions: payload.mentions,
        attachments: payload.attachments,
        sequence: event.sequence,
        origin_ts: Date.now(),
      });
    } catch (err) {
      console.error(err);
      dropOptimistic(channelId, localId);
    }
  }

  const [dragActive, setDragActive] = useState(false);
  const dragDepth = useRef(0);

  useEffect(() => {
    setDragActive(false);
    dragDepth.current = 0;
  }, [channelId]);

  function handleDragEnter(e: React.DragEvent<HTMLElement>) {
    if (!hasFiles(e.dataTransfer)) return;
    dragDepth.current += 1;
    setDragActive(true);
  }

  function handleDragLeave() {
    dragDepth.current = Math.max(0, dragDepth.current - 1);
    if (dragDepth.current === 0) setDragActive(false);
  }

  function handleDrop(e: React.DragEvent<HTMLElement>) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const files = Array.from(e.dataTransfer.files ?? []);
    if (files.length === 0 || !channelId) return;
    window.dispatchEvent(
      new CustomEvent<{ channelId: string; files: File[] }>("collab:files-dropped", {
        detail: { channelId, files },
      })
    );
  }

  if (!channelId) return null;

  return (
    <section
      className="relative flex h-full flex-1 flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={(e) => {
        if (hasFiles(e.dataTransfer)) e.preventDefault();
      }}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      <ChannelHeader channelId={channelId} channel={channel} />
      <MessageList messages={messages} channelId={channelId} onOpenThread={openThread} />
      <TypingIndicator channelId={channelId} />
      <Composer channelId={channelId} placeholder={composerPlaceholder} onSend={handleSend} />
      {dragActive && <DropOverlay channelName={channel?.name ?? channelId} />}
    </section>
  );
}

function hasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes("Files");
}
