import { useParams } from "react-router";
import { Composer } from "../components/Composer.tsx";
import { MessageList } from "../components/MessageList.tsx";
import { callFunction } from "../lib/api.ts";
import { useSync } from "../state/sync.ts";

export function ChannelPage() {
  const { workspaceId, channelId } = useParams<{ workspaceId: string; channelId: string }>();
  const messages = useSync((s) => (channelId ? s.messagesByChannel[channelId] ?? [] : []));
  const channel = useSync((s) => (channelId ? s.channels[channelId] : undefined));
  const applyOptimistic = useSync((s) => s.applyOptimistic);
  const reconcile = useSync((s) => s.reconcileOptimistic);

  async function handleSend(text: string) {
    if (!workspaceId || !channelId) return;
    const localId = `local-${crypto.randomUUID()}`;
    applyOptimistic({
      id: localId,
      channel_id: channelId,
      thread_root: null,
      sender_id: "me",
      sender_type: "human",
      content: text,
      mentions: [],
      sequence: -1,
    });
    try {
      const result = await callFunction<{ event_id: string; sequence: number }>("chat:send-message", {
        workspace_id: workspaceId,
        channel_id: channelId,
        content: text,
      });
      reconcile(localId, {
        id: result.event_id,
        channel_id: channelId,
        thread_root: null,
        sender_id: "me",
        sender_type: "human",
        content: text,
        mentions: [],
        sequence: result.sequence,
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
