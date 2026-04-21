import { Avatar } from "@collabai/ui";
import { useEffect, useRef } from "react";
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
            <li
              key={m.id}
              data-testid="message"
              data-pending={m.pending ? "true" : "false"}
              className="flex items-start gap-2"
            >
              <Avatar name={m.sender_id} kind={m.sender_type} size={32} />
              <div>
                <p className="text-xs text-slate-500">
                  <span className="text-slate-300">{m.sender_id}</span>
                  {m.sender_type === "agent" && (
                    <span className="ml-2 rounded bg-collab-teal-700 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-collab-teal-100">
                      agent
                    </span>
                  )}
                  {m.pending && <span className="ml-2 text-amber-400">sending…</span>}
                </p>
                <p className="text-sm text-slate-100">
                  {m.redacted ? <em className="text-slate-500">[deleted]</em> : m.content}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
