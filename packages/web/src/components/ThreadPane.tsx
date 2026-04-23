/**
 * Right-rail thread reply pane.
 *
 * Renders the root message + every reply (`thread_root === rootId`)
 * with a dedicated composer that automatically threads replies. The
 * pane is mounted by `WorkspaceShell` whenever `useThread().rootId` is
 * set; closing dispatches `close()` to the same store.
 */
import { Avatar, Badge, Button } from "@collabai/ui";
import { useEffect, useMemo, useRef } from "react";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Message } from "../state/sync.ts";
import { useThread } from "../state/threads.ts";
import { Composer, type ComposerSendPayload } from "./Composer.tsx";

const EMPTY: Message[] = [];

export function ThreadPane() {
  const rootId = useThread((s) => s.rootId);
  const close = useThread((s) => s.close);
  const root = useSync((s) => (rootId ? s.messageById[rootId] : undefined));
  const all = useSync((s) => (root ? (s.messagesByChannel[root.channel_id] ?? EMPTY) : EMPTY));
  const replies = useMemo(() => (root ? all.filter((m) => m.thread_root === root.id) : []), [all, root]);
  const identity = useAuth((s) => s.identity);
  const applyOptimistic = useSync((s) => s.applyOptimistic);
  const reconcile = useSync((s) => s.reconcileOptimistic);

  const tailRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    tailRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
  }, [replies.length]);

  if (!rootId || !root) return null;

  async function handleSend(payload: ComposerSendPayload) {
    if (!identity || !root) return;
    const localId = `local-${crypto.randomUUID()}`;
    applyOptimistic({
      id: localId,
      channel_id: root.channel_id,
      thread_root: root.id,
      sender_id: identity.user_id,
      sender_type: "human",
      content: payload.text,
      mentions: payload.mentions,
      attachments: payload.attachments,
      sequence: -1,
      origin_ts: Date.now(),
    });
    try {
      const result = await callFunction<{
        status: string;
        events: Array<{ event_id: string; sequence: number }>;
      }>("chat:send-message", {
        channel_id: root.channel_id,
        content: payload.text,
        thread_root: root.id,
        mentions: payload.mentions,
        attachments: payload.attachments,
      });
      const ev = result.events[0];
      if (result.status === "applied" && ev) {
        reconcile(localId, {
          id: ev.event_id,
          channel_id: root.channel_id,
          thread_root: root.id,
          sender_id: identity.user_id,
          sender_type: "human",
          content: payload.text,
          mentions: payload.mentions,
          attachments: payload.attachments,
          sequence: ev.sequence,
          origin_ts: Date.now(),
        });
      }
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <aside className="fixed inset-0 z-40 flex flex-col bg-background lg:static lg:z-auto lg:w-96 lg:border-l lg:border-border">
      <header className="flex items-center justify-between border-b border-border px-3 py-3">
        <div>
          <p className="text-sm font-semibold text-foreground">Thread</p>
          <p className="text-xs text-tertiary">{replies.length} replies</p>
        </div>
        <button
          type="button"
          aria-label="Close thread"
          onClick={close}
          className="rounded-md p-1 text-tertiary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          ✕
        </button>
      </header>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <ThreadEntry message={root} />
        {replies.length > 0 && (
          <div className="my-3 flex items-center gap-2 text-xs text-tertiary">
            <span className="h-px flex-1 bg-border" />
            <span>
              {replies.length} {replies.length === 1 ? "reply" : "replies"}
            </span>
            <span className="h-px flex-1 bg-border" />
          </div>
        )}
        <ul className="flex flex-col gap-2">
          {replies.map((m) => (
            <li key={m.id}>
              <ThreadEntry message={m} compact />
            </li>
          ))}
        </ul>
        <div ref={tailRef} />
      </div>
      <div className="border-t border-border">
        <Composer channelId={root.channel_id} threadRoot={root.id} placeholder="Reply…" onSend={handleSend} />
      </div>
    </aside>
  );
}

function ThreadEntry({ message, compact }: { message: Message; compact?: boolean }) {
  const name = useDisplayName(message.sender_id);
  return (
    <div className="flex items-start gap-2">
      <Avatar name={name || message.sender_id} kind={message.sender_type} size={compact ? 24 : 32} />
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-xs text-tertiary">
          <span className="text-sm font-semibold text-foreground">{name || message.sender_id}</span>
          {message.sender_type === "agent" && (
            <Badge tone="agent" className="!normal-case">
              agent
            </Badge>
          )}
          <span>
            {new Date(message.origin_ts).toLocaleTimeString(undefined, {
              hour: "numeric",
              minute: "2-digit",
            })}
          </span>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-foreground">
          {message.redacted ? <em className="text-tertiary">[deleted]</em> : message.content}
        </p>
      </div>
    </div>
  );
}
