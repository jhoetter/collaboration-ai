import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router";
import { ChannelHeader } from "../components/ChannelHeader.tsx";
import { Composer, type ComposerSendPayload } from "../components/Composer.tsx";
import { DropOverlay } from "../components/DropOverlay.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { TypingIndicator } from "../components/TypingIndicator.tsx";
import { callFunction } from "../lib/api.ts";
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
    channelId ? s.messagesByChannel[channelId] ?? EMPTY_MESSAGES : EMPTY_MESSAGES,
  );
  const channel = useSync((s) => (channelId ? s.channels[channelId] : undefined));
  const applyOptimistic = useSync((s) => s.applyOptimistic);
  const reconcile = useSync((s) => s.reconcileOptimistic);
  const dropOptimistic = useSync((s) => s.dropOptimistic);
  const openThread = useThread((s) => s.open);

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
      }),
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
      <Composer
        channelId={channelId}
        placeholder={`Message #${channel?.name ?? channelId}`}
        onSend={handleSend}
      />
      {dragActive && <DropOverlay channelName={channel?.name ?? channelId} />}
    </section>
  );
}

function hasFiles(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types ?? []).includes("Files");
}
