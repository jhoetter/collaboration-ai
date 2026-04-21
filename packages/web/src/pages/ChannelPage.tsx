import { useParams } from "react-router";
import { Composer } from "../components/Composer.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Message } from "../state/sync.ts";

// Stable empty fallback so the selector returns the same reference on every
// render when the channel has no messages yet. Returning a fresh `[]`
// literal makes Zustand think state changed and triggers an infinite loop.
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

  async function handleSend(text: string) {
    if (!channelId || !identity) return;
    const localId = `local-${crypto.randomUUID()}`;
    applyOptimistic({
      id: localId,
      channel_id: channelId,
      thread_root: null,
      sender_id: identity.user_id,
      sender_type: "human",
      content: text,
      mentions: [],
      sequence: -1,
    });
    try {
      const result = await callFunction<SendMessageResponse>("chat:send-message", {
        channel_id: channelId,
        content: text,
      });
      if (result.status !== "applied" || result.events.length === 0) {
        console.error("send rejected", result.error);
        return;
      }
      const event = result.events[0];
      reconcile(localId, {
        id: event.event_id,
        channel_id: channelId,
        thread_root: null,
        sender_id: event.sender_id,
        sender_type: event.sender_type,
        content: text,
        mentions: [],
        sequence: event.sequence,
      });
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <section className="flex h-full flex-1 flex-col">
      <header className="flex items-center gap-2 border-b border-slate-800 bg-slate-900 px-4 py-2">
        <h1 className="text-sm font-semibold text-slate-100">#{channel?.name ?? channelId}</h1>
      </header>
      <MessageList messages={messages} />
      <Composer onSend={handleSend} />
    </section>
  );
}
