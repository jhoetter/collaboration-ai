/**
 * Slack-style message list.
 *
 * - Groups consecutive messages from the same sender (no avatar repeat
 *   within ~5 minutes).
 * - Renders markdown, mention chips, attachment cards (image preview
 *   for image MIME types, generic file card otherwise).
 * - Hover toolbar: emoji react, reply in thread, pin/unpin, edit/delete
 *   for own messages, copy link.
 * - Reactions bar: per-emoji count + "you reacted" highlight; click to
 *   toggle. Trailing "+" opens the picker.
 * - Auto-scroll on new messages when already at bottom; preserves
 *   position when reading older history.
 */
import { Avatar, Badge, PresenceDot } from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment, type Message, type PresenceStatus } from "../state/sync.ts";
import { useUsers } from "../state/users.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";

export interface MessageListProps {
  messages: Message[];
  channelId: string;
  onOpenThread?: (rootId: string) => void;
}

const GROUP_GAP_MS = 5 * 60 * 1000;

export function MessageList({ messages, channelId, onOpenThread }: MessageListProps) {
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const identity = useAuth((s) => s.identity);
  const setReadUpTo = useSync((s) => s.setReadUpTo);
  const readUpTo = useSync((s) => s.readUpToByChannel[channelId] ?? 0);
  const presence = useSync((s) => s.presence);

  const visible = useMemo(() => messages.filter((m) => !m.thread_root), [messages]);
  const grouped = useMemo(() => groupMessages(visible), [visible]);

  useEffect(() => {
    if (stickToBottom.current && ref.current) {
      ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    }
  }, [visible.length]);

  // Mark read when scrolled to bottom.
  useEffect(() => {
    if (visible.length === 0) return;
    const tail = visible[visible.length - 1];
    if (tail.sequence > readUpTo && stickToBottom.current && identity) {
      void callFunction("chat:mark-read", { up_to_event_id: tail.id }).catch(() => undefined);
      setReadUpTo(channelId, tail.sequence);
    }
  }, [visible, readUpTo, channelId, setReadUpTo, identity]);

  function handleScroll(e: React.UIEvent<HTMLDivElement>) {
    const el = e.currentTarget;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
  }

  return (
    <div ref={ref} className="flex-1 overflow-y-auto px-4 py-3" onScroll={handleScroll}>
      {visible.length === 0 ? (
        <p className="text-sm text-slate-500">No messages yet — say hi.</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {grouped.map((group) => (
            <MessageGroup
              key={group.head.id}
              group={group}
              presence={presence}
              onOpenThread={onOpenThread}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

interface Group {
  head: Message;
  rest: Message[];
}

function groupMessages(messages: Message[]): Group[] {
  const groups: Group[] = [];
  for (const m of messages) {
    const last = groups[groups.length - 1];
    if (
      last &&
      last.head.sender_id === m.sender_id &&
      m.origin_ts - (last.rest.at(-1)?.origin_ts ?? last.head.origin_ts) < GROUP_GAP_MS
    ) {
      last.rest.push(m);
    } else {
      groups.push({ head: m, rest: [] });
    }
  }
  return groups;
}

function MessageGroup({
  group,
  presence,
  onOpenThread,
}: {
  group: Group;
  presence: Record<string, PresenceStatus>;
  onOpenThread?: (rootId: string) => void;
}) {
  const name = useDisplayName(group.head.sender_id);
  const status = mapPresence(presence[group.head.sender_id]);
  return (
    <li className="group flex items-start gap-2 rounded px-2 py-1 hover:bg-slate-900/50">
      <div className="relative pt-0.5">
        <Avatar name={name || group.head.sender_id} kind={group.head.sender_type} size={32} />
        {group.head.sender_type === "human" && (
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={status} />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex items-baseline gap-2 text-xs text-slate-500">
          <span className="text-sm font-semibold text-slate-100">
            {name || group.head.sender_id}
          </span>
          {group.head.sender_type === "agent" && (
            <Badge tone="agent" className="!normal-case">
              agent
            </Badge>
          )}
          <span>{formatTime(group.head.origin_ts)}</span>
        </p>
        <MessageBody message={group.head} onOpenThread={onOpenThread} />
        {group.rest.map((m) => (
          <MessageBody key={m.id} message={m} onOpenThread={onOpenThread} compact />
        ))}
      </div>
    </li>
  );
}

function MessageBody({
  message,
  compact,
  onOpenThread,
}: {
  message: Message;
  compact?: boolean;
  onOpenThread?: (rootId: string) => void;
}) {
  const identity = useAuth((s) => s.identity);
  const reactions = useSync((s) => s.reactionsByMessage[message.id]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  const [showPicker, setShowPicker] = useState(false);
  const isOwn = identity?.user_id === message.sender_id;

  async function toggleReaction(emoji: string) {
    if (!identity) return;
    const userIds = reactions?.[emoji] ?? [];
    if (userIds.includes(identity.user_id)) {
      await callFunction("chat:remove-reaction", { target_event_id: message.id, emoji });
    } else {
      await callFunction("chat:add-reaction", { target_event_id: message.id, emoji });
    }
  }

  async function commitEdit() {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === message.content) {
      setEditing(false);
      return;
    }
    await callFunction("chat:edit-message", {
      target_event_id: message.id,
      new_content: trimmed,
    });
    setEditing(false);
  }

  async function deleteMessage() {
    if (!confirm("Delete this message?")) return;
    await callFunction("chat:delete-message", { target_event_id: message.id });
  }

  async function pinMessage() {
    await callFunction("chat:pin-message", { target_event_id: message.id });
  }

  return (
    <div
      data-testid="message"
      data-pending={message.pending ? "true" : "false"}
      className={`relative ${compact ? "py-0.5" : ""}`}
    >
      {editing ? (
        <div className="rounded border border-slate-700 bg-slate-800 px-2 py-1">
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void commitEdit();
              } else if (e.key === "Escape") {
                setEditing(false);
                setDraft(message.content);
              }
            }}
            className="w-full resize-none bg-transparent text-sm text-slate-100 outline-none"
            rows={Math.min(8, draft.split("\n").length + 1)}
          />
          <div className="mt-1 flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="text-slate-400 hover:text-slate-200"
              onClick={() => {
                setEditing(false);
                setDraft(message.content);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="text-collab-teal-300 hover:text-collab-teal-100"
              onClick={() => void commitEdit()}
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm leading-snug text-slate-100">
          {message.redacted ? (
            <em className="text-slate-500">[deleted]</em>
          ) : (
            <>
              <MarkdownContent content={message.content} mentions={message.mentions} />
              {message.edited_at && <span className="ml-1 text-xs text-slate-500">(edited)</span>}
              {message.pending && <span className="ml-2 text-xs text-amber-400">sending…</span>}
            </>
          )}
        </div>
      )}

      {message.attachments.length > 0 && !message.redacted && (
        <div className="mt-1 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <AttachmentCard key={a.file_id} attachment={a} />
          ))}
        </div>
      )}

      {reactions && Object.keys(reactions).length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {Object.entries(reactions).map(([emoji, users]) => {
            const mine = identity ? users.includes(identity.user_id) : false;
            return (
              <button
                key={emoji}
                type="button"
                onClick={() => void toggleReaction(emoji)}
                className={`flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${
                  mine
                    ? "border-collab-teal-500 bg-collab-teal-900/40 text-collab-teal-100"
                    : "border-slate-700 bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                <span>{emoji}</span>
                <span>{users.length}</span>
              </button>
            );
          })}
        </div>
      )}

      {!message.redacted && (message.thread_reply_count ?? 0) > 0 && onOpenThread && (
        <button
          type="button"
          onClick={() => onOpenThread(message.id)}
          className="mt-1 inline-flex items-center gap-1 rounded text-xs text-collab-teal-300 hover:underline"
        >
          💬 {message.thread_reply_count}{" "}
          {(message.thread_reply_count ?? 0) === 1 ? "reply" : "replies"}
        </button>
      )}

      {/* Hover toolbar */}
      {!message.redacted && !editing && (
        <div className="absolute -top-3 right-2 hidden items-center gap-1 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 shadow-lg group-hover:flex">
          <ToolbarButton label="Add reaction" onClick={() => setShowPicker((v) => !v)}>
            😀
          </ToolbarButton>
          {onOpenThread && (
            <ToolbarButton label="Reply in thread" onClick={() => onOpenThread(message.id)}>
              💬
            </ToolbarButton>
          )}
          <ToolbarButton label="Pin message" onClick={() => void pinMessage()}>
            📌
          </ToolbarButton>
          {isOwn && (
            <>
              <ToolbarButton label="Edit message" onClick={() => setEditing(true)}>
                ✎
              </ToolbarButton>
              <ToolbarButton label="Delete message" onClick={() => void deleteMessage()}>
                🗑
              </ToolbarButton>
            </>
          )}
        </div>
      )}
      {showPicker && (
        <div className="absolute z-30 mt-1">
          <EmojiPicker
            onPick={(emoji) => {
              setShowPicker(false);
              void toggleReaction(emoji);
            }}
            onClose={() => setShowPicker(false)}
          />
        </div>
      )}
    </div>
  );
}

function ToolbarButton({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="h-6 w-6 rounded text-xs text-slate-300 hover:bg-slate-800 hover:text-slate-100"
    >
      {children}
    </button>
  );
}

function MarkdownContent({ content, mentions }: { content: string; mentions: string[] }) {
  const usersById = useUsers((s) => s.byId);
  // Highlight @mentions visually before passing to markdown renderer so
  // they survive the markdown pipeline.
  const enhanced = useMemo(() => {
    if (!content) return "";
    let next = content;
    for (const userId of mentions) {
      const display = usersById[userId]?.display_name ?? userId;
      const escaped = display.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`@${escaped}`, "g"), `**@${display}**`);
    }
    return next;
  }, [content, mentions, usersById]);
  return (
    <div className="prose prose-invert prose-sm max-w-none break-words">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node, ...props }) => (
            <a
              {...props}
              className="text-collab-teal-300 underline-offset-2 hover:underline"
              target="_blank"
              rel="noreferrer"
            />
          ),
          code: ({ node, className, children, ...props }) => (
            <code
              className={`rounded bg-slate-800 px-1 py-0.5 text-xs text-amber-200 ${className ?? ""}`}
              {...props}
            >
              {children}
            </code>
          ),
        }}
      >
        {enhanced}
      </ReactMarkdown>
    </div>
  );
}

function AttachmentCard({ attachment }: { attachment: Attachment }) {
  const [url, setUrl] = useState<string | null>(attachment.thumbnail_url ?? null);
  const isImage = attachment.mime.startsWith("image/");

  useEffect(() => {
    if (url) return;
    let cancelled = false;
    void callFunction<{ get_url: string }>("attachment:download-url", {
      file_id: attachment.file_id,
    })
      .then((res) => {
        if (!cancelled) setUrl(res.get_url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachment.file_id, url]);

  if (isImage && url) {
    return (
      <a href={url} target="_blank" rel="noreferrer" className="block">
        <img
          src={url}
          alt={attachment.name}
          className="max-h-64 rounded border border-slate-800 object-cover"
        />
      </a>
    );
  }
  return (
    <a
      href={url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-3 py-2 text-xs text-slate-200 hover:border-slate-600"
    >
      <span aria-hidden="true">📄</span>
      <div className="flex flex-col">
        <span className="font-medium">{attachment.name}</span>
        <span className="text-slate-500">{formatBytes(attachment.size_bytes)}</span>
      </div>
    </a>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return time;
  return `${d.toLocaleDateString(undefined, { month: "short", day: "numeric" })} ${time}`;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function mapPresence(s: PresenceStatus | undefined): "online" | "idle" | "dnd" | "offline" {
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
