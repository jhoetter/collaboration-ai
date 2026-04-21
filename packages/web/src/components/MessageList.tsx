import { Avatar } from "@collabai/ui";
import { useEffect, useRef } from "react";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import type { Message } from "../state/sync.ts";

export interface MessageListProps {
  messages: Message[];
}

export function MessageList({ messages }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.scrollTo({ top: ref.current.scrollHeight });
  }, [messages.length]);

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3">
      {messages.length === 0 ? (
        <p className="text-sm text-slate-500">No messages yet — say hi.</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
        </ul>
      )}
    </div>
  );
}

function MessageRow({ message }: { message: Message }) {
  const name = useDisplayName(message.sender_id);
  return (
    <li
      data-testid="message"
      data-pending={message.pending ? "true" : "false"}
      className="flex items-start gap-2"
    >
      <Avatar name={name || message.sender_id} kind={message.sender_type} size={32} />
      <div>
        <p className="text-xs text-slate-500">
          <span className="text-slate-300">{name || message.sender_id}</span>
          {message.sender_type === "agent" && (
            <span className="ml-2 rounded bg-collab-teal-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-collab-teal-100">
              agent
            </span>
          )}
          {message.pending && <span className="ml-2 text-amber-400">sending…</span>}
        </p>
        <p className="text-sm text-slate-100">
          {message.redacted ? <em className="text-slate-500">[deleted]</em> : message.content}
        </p>
      </div>
    </li>
  );
}
