/**
 * Slack-style message list.
 *
 * - Groups consecutive messages from the same sender (no avatar repeat
 *   within ~5 minutes).
 * - Renders markdown, mention chips, attachment cards (image preview
 *   for image MIME types, generic file card otherwise).
 * - Date dividers separate days; a floating "X new messages" pill jumps
 *   to the first unread when the user has scrolled away from the bottom.
 * - Hover toolbar v2: 5 quick reactions, full picker, reply in thread,
 *   share (copy permalink), save (star), more menu (edit/delete/pin/
 *   mark unread/copy link).
 * - Reactions strip v2: pill with emoji + count + reactor tooltip
 *   ("Alice, Bob and 2 others reacted").
 * - Auto-scroll on new messages when already at bottom; preserves
 *   position when reading older history.
 */
import {
  Avatar,
  Badge,
  IconArrowDown,
  IconBookmark,
  IconCopy,
  IconMore,
  IconPencil,
  IconPin,
  IconReply,
  IconSmile,
  IconTrash,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
} from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment, type Message } from "../state/sync.ts";
import { useToasts } from "../state/toasts.ts";
import { useUsers } from "../state/users.ts";
import { AttachmentCard } from "./AttachmentCard.tsx";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { Lightbox, useLightbox } from "./Lightbox.tsx";
import { PopoverPortal } from "./PopoverPortal.tsx";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀"];
// Stable empty references — Zustand selectors return the *same* reference
// across re-renders or React hits "getSnapshot should be cached" → infinite
// loop. `[] as const` would still be a fresh array per render.
const EMPTY_STAR_LIST: readonly string[] = Object.freeze([]);

export interface MessageListProps {
  messages: Message[];
  channelId: string;
  onOpenThread?: (rootId: string) => void;
}

const GROUP_GAP_MS = 5 * 60 * 1000;

export function MessageList({ messages, channelId, onOpenThread }: MessageListProps) {
  const { t } = useTranslator();
  const ref = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const identity = useAuth((s) => s.identity);
  const setReadUpTo = useSync((s) => s.setReadUpTo);
  const readUpTo = useSync((s) => s.readUpToByChannel[channelId] ?? 0);
  const lightbox = useLightbox();

  const visible = useMemo(() => messages.filter((m) => !m.thread_root), [messages]);
  const grouped = useMemo(() => groupMessages(visible), [visible]);
  const dividers = useMemo(() => buildDividers(grouped), [grouped]);
  const [, forceTick] = useState(0);

  // Count unread messages from someone else above the current read marker.
  const unreadCount = useMemo(() => {
    let n = 0;
    for (const m of visible) {
      if (m.sequence > readUpTo && (!identity || m.sender_id !== identity.user_id)) n += 1;
    }
    return n;
  }, [visible, readUpTo, identity]);

  useEffect(() => {
    if (stickToBottom.current && ref.current) {
      ref.current.scrollTo({ top: ref.current.scrollHeight, behavior: "smooth" });
    }
  }, [visible.length]);

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
    forceTick((n) => n + 1);
  }

  function jumpToBottom() {
    const el = ref.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }

  function jumpToFirstUnread() {
    const el = ref.current;
    if (!el) return;
    const target = el.querySelector<HTMLElement>(`[data-first-unread="true"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    } else {
      jumpToBottom();
    }
  }

  const showJumpPill = !stickToBottom.current && unreadCount > 0;
  const showLatestPill = !stickToBottom.current && unreadCount === 0 && visible.length > 0;
  const firstUnreadId = useMemo(() => {
    for (const m of visible) {
      if (m.sequence > readUpTo && (!identity || m.sender_id !== identity.user_id)) {
        return m.id;
      }
    }
    return null;
  }, [visible, readUpTo, identity]);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={ref} className="h-full overflow-y-auto px-4 py-3" onScroll={handleScroll}>
        {visible.length === 0 ? (
          <EmptyChannelState channelId={channelId} />
        ) : (
          <ul className="flex flex-col gap-0.5">
            {grouped.map((group, idx) => {
              const divider = dividers[idx];
              return (
                <Fragment key={group.head.id}>
                  {divider && <DateDivider ts={divider.ts} />}
                  <MessageGroup
                    group={group}
                    onOpenThread={onOpenThread}
                    firstUnreadId={firstUnreadId}
                    onPreviewImage={(att, peers) => lightbox.open(att, peers)}
                  />
                </Fragment>
              );
            })}
          </ul>
        )}
      </div>
      {showJumpPill && (
        <button
          type="button"
          onClick={jumpToFirstUnread}
          className="absolute right-6 top-3 inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground shadow-lg transition-transform hover:-translate-y-0.5"
        >
          <IconArrowDown size={14} />
          {unreadCount === 1
            ? t("messageList.newMessagesOne")
            : t("messageList.newMessages", { n: unreadCount })}
        </button>
      )}
      {showLatestPill && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-secondary shadow-lg transition-colors hover:bg-hover hover:text-foreground"
        >
          <IconArrowDown size={14} />
          {t("messageList.jumpToLatest")}
        </button>
      )}
      {lightbox.entry && (
        <Lightbox
          entry={lightbox.entry}
          peers={lightbox.peers}
          onClose={lightbox.close}
          onPrev={lightbox.prev}
          onNext={lightbox.next}
        />
      )}
    </div>
  );
}

function Fragment({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
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
      m.origin_ts - (last.rest.at(-1)?.origin_ts ?? last.head.origin_ts) < GROUP_GAP_MS &&
      sameDay(last.head.origin_ts, m.origin_ts)
    ) {
      last.rest.push(m);
    } else {
      groups.push({ head: m, rest: [] });
    }
  }
  return groups;
}

function buildDividers(
  groups: Group[],
): Array<{ ts: number } | null> {
  const out: Array<{ ts: number } | null> = [];
  let prevTs: number | null = null;
  for (const g of groups) {
    if (prevTs === null || !sameDay(prevTs, g.head.origin_ts)) {
      out.push({ ts: g.head.origin_ts });
    } else {
      out.push(null);
    }
    prevTs = g.head.origin_ts;
  }
  return out;
}

function DateDivider({ ts }: { ts: number }) {
  const { t } = useTranslator();
  const label = formatDateLabel(ts, t);
  return (
    <li
      role="separator"
      aria-label={label}
      className="sticky top-0 z-[5] my-3 flex select-none items-center gap-2 text-xs text-tertiary"
    >
      <span className="h-px flex-1 bg-border" />
      <span className="rounded-full border border-border bg-card px-3 py-0.5 font-medium text-secondary">
        {label}
      </span>
      <span className="h-px flex-1 bg-border" />
    </li>
  );
}

function MessageGroup({
  group,
  onOpenThread,
  firstUnreadId,
  onPreviewImage,
}: {
  group: Group;
  onOpenThread?: (rootId: string) => void;
  firstUnreadId: string | null;
  onPreviewImage: (att: Attachment, peers: Attachment[]) => void;
}) {
  const name = useDisplayName(group.head.sender_id);
  const displayName = name || group.head.sender_id;
  return (
    <li className="flex flex-col">
      <MessageRow
        message={group.head}
        onOpenThread={onOpenThread}
        isFirstUnread={firstUnreadId === group.head.id}
        onPreviewImage={onPreviewImage}
        leading={
          <div className="pt-0.5">
            <Avatar name={displayName} kind={group.head.sender_type} size={32} />
          </div>
        }
        header={
          <p className="flex items-baseline gap-2 text-xs text-tertiary">
            <span className="text-sm font-semibold text-foreground">{displayName}</span>
            {group.head.sender_type === "agent" && (
              <Badge tone="agent" className="!normal-case">
                agent
              </Badge>
            )}
            <span>{formatTime(group.head.origin_ts)}</span>
          </p>
        }
      />
      {group.rest.map((m) => (
        <MessageRow
          key={m.id}
          message={m}
          onOpenThread={onOpenThread}
          isFirstUnread={firstUnreadId === m.id}
          onPreviewImage={onPreviewImage}
          compact
          leading={
            <span className="invisible select-none pt-0.5 text-[10px] tabular-nums leading-none text-tertiary group-hover/msg:visible">
              {formatHoverTime(m.origin_ts)}
            </span>
          }
        />
      ))}
    </li>
  );
}

function MessageRow({
  message,
  leading,
  header,
  compact,
  onOpenThread,
  isFirstUnread,
  onPreviewImage,
}: {
  message: Message;
  leading: React.ReactNode;
  header?: React.ReactNode;
  compact?: boolean;
  onOpenThread?: (rootId: string) => void;
  isFirstUnread?: boolean;
  onPreviewImage: (att: Attachment, peers: Attachment[]) => void;
}) {
  return (
    <div
      className={`group/msg relative flex items-start gap-2 rounded-md px-2 transition-colors duration-150 hover:bg-hover ${
        compact ? "py-0.5" : "py-1"
      }`}
    >
      <div className="flex w-8 shrink-0 justify-center">{leading}</div>
      <div className="min-w-0 flex-1">
        {header}
        <MessageBody
          message={message}
          onOpenThread={onOpenThread}
          isFirstUnread={isFirstUnread}
          onPreviewImage={onPreviewImage}
        />
      </div>
    </div>
  );
}

function MessageBody({
  message,
  onOpenThread,
  isFirstUnread,
  onPreviewImage,
}: {
  message: Message;
  onOpenThread?: (rootId: string) => void;
  isFirstUnread?: boolean;
  onPreviewImage: (att: Attachment, peers: Attachment[]) => void;
}) {
  const { t } = useTranslator();
  const identity = useAuth((s) => s.identity);
  const reactions = useSync((s) => s.reactionsByMessage[message.id]);
  const starredBy = useSync(
    (s) => s.starredByMessage[message.id] ?? EMPTY_STAR_LIST,
  );
  const pushToast = useToasts((s) => s.push);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);
  // The anchor remembers which button opened the reaction picker so the
  // popover sits next to *that* trigger (toolbar smile vs. inline "+"
  // pill) instead of always flying off to the top-right of the row.
  const [pickerAnchor, setPickerAnchor] = useState<HTMLElement | null>(null);
  const inlineAddRef = useRef<HTMLButtonElement>(null);
  const toolbarSmileRef = useRef<HTMLButtonElement>(null);
  const [showMore, setShowMore] = useState(false);

  function togglePicker(anchor: HTMLElement | null) {
    setPickerAnchor((prev) => (prev ? null : anchor));
  }
  const isOwn = identity?.user_id === message.sender_id;
  const isStarred = identity ? starredBy.includes(identity.user_id) : false;
  const imageAttachments = useMemo(
    () => message.attachments.filter((a) => a.mime.startsWith("image/")),
    [message.attachments],
  );

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
    if (!confirm(t("messageActions.deleteConfirm"))) return;
    await callFunction("chat:delete-message", { target_event_id: message.id });
  }

  async function pinMessage() {
    await callFunction("chat:pin-message", { target_event_id: message.id });
  }

  async function toggleStar() {
    const fn = isStarred ? "chat:unstar-message" : "chat:star-message";
    try {
      await callFunction(fn, { target_event_id: message.id });
      pushToast({
        title: isStarred ? undefined : t("messageActions.saved"),
        tone: "success",
        durationMs: 2500,
      });
    } catch (err) {
      console.error(fn, err);
    }
  }

  async function markUnread() {
    try {
      await callFunction("chat:mark-unread", { target_event_id: message.id });
    } catch (err) {
      console.error("chat:mark-unread", err);
    }
  }

  async function copyLink() {
    const link = `${window.location.origin}${window.location.pathname}#message-${message.id}`;
    try {
      await navigator.clipboard?.writeText(link);
      pushToast({ title: t("messageActions.linkCopied"), tone: "info", durationMs: 2000 });
    } catch {
      window.prompt(t("messageActions.copyLink"), link);
    }
  }

  return (
    <div
      data-testid="message"
      data-pending={message.pending ? "true" : "false"}
      data-first-unread={isFirstUnread ? "true" : undefined}
      id={`message-${message.id}`}
      className="relative"
    >
      {editing ? (
        <div className="rounded-md border border-border bg-background px-2 py-1.5">
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
            className="w-full resize-none bg-transparent text-sm text-foreground outline-none"
            rows={Math.min(8, draft.split("\n").length + 1)}
          />
          <div className="mt-1 flex justify-end gap-2 text-xs">
            <button
              type="button"
              className="text-secondary transition-colors hover:text-foreground"
              onClick={() => {
                setEditing(false);
                setDraft(message.content);
              }}
            >
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className="font-medium text-accent transition-opacity hover:opacity-80"
              onClick={() => void commitEdit()}
            >
              {t("common.save")}
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm leading-relaxed text-foreground">
          {message.redacted ? (
            <em className="text-tertiary">[deleted]</em>
          ) : (
            <>
              <MarkdownContent content={message.content} mentions={message.mentions} />
              {message.edited_at && <span className="ml-1 text-xs text-tertiary">(edited)</span>}
              {message.pending && (
                <span className="ml-2 text-xs text-warning">{t("composer.sending")}</span>
              )}
            </>
          )}
        </div>
      )}

      {message.attachments.length > 0 && !message.redacted && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {message.attachments.map((a) => (
            <AttachmentCard
              key={a.file_id}
              attachment={a}
              onOpenImage={() => onPreviewImage(a, imageAttachments)}
            />
          ))}
        </div>
      )}

      {reactions && Object.keys(reactions).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {Object.entries(reactions).map(([emoji, users]) => (
            <ReactionChip
              key={emoji}
              emoji={emoji}
              users={users}
              meId={identity?.user_id ?? null}
              onClick={() => void toggleReaction(emoji)}
            />
          ))}
          <button
            ref={inlineAddRef}
            type="button"
            onClick={() => togglePicker(inlineAddRef.current)}
            className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-border bg-card text-secondary transition-colors hover:bg-hover hover:text-foreground"
            aria-label={t("messageActions.addReaction")}
          >
            <IconSmile size={14} />
          </button>
        </div>
      )}

      {!message.redacted && (message.thread_reply_count ?? 0) > 0 && onOpenThread && (
        <button
          type="button"
          onClick={() => onOpenThread(message.id)}
          className="mt-1 inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium text-accent transition-colors hover:bg-accent-light"
        >
          <IconReply size={12} />
          {message.thread_reply_count}{" "}
          {(message.thread_reply_count ?? 0) === 1
            ? t("thread.replyCountOne").replace("1 ", "")
            : t("thread.replyCount", { n: message.thread_reply_count ?? 0 }).replace(
                /^\d+\s/,
                "",
              )}
        </button>
      )}

      {!message.redacted && !editing && (
        <div className="absolute -top-3.5 right-2 z-10 hidden group-hover/msg:block">
          <Toolbar density="compact" surface="floating">
            {QUICK_REACTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                title={emoji}
                aria-label={`React ${emoji}`}
                onClick={() => void toggleReaction(emoji)}
                className="inline-flex h-6 w-6 items-center justify-center rounded text-sm leading-none transition-transform duration-100 hover:scale-110"
              >
                <span aria-hidden="true">{emoji}</span>
              </button>
            ))}
            <ToolbarButton
              ref={toolbarSmileRef}
              label={t("messageActions.addReaction")}
              onClick={() => togglePicker(toolbarSmileRef.current)}
            >
              <IconSmile />
            </ToolbarButton>
            <ToolbarDivider />
            {onOpenThread && (
              <ToolbarButton
                label={t("messageActions.replyInThread")}
                onClick={() => onOpenThread(message.id)}
              >
                <IconReply />
              </ToolbarButton>
            )}
            <ToolbarButton
              label={isStarred ? t("messageActions.saved") : t("messageActions.save")}
              active={isStarred}
              onClick={() => void toggleStar()}
            >
              <IconBookmark
                fill={isStarred ? "currentColor" : "none"}
                style={isStarred ? { color: "var(--color-accent)" } : undefined}
              />
            </ToolbarButton>
            <ToolbarButton
              label={t("messageActions.share")}
              onClick={() => void copyLink()}
            >
              <IconCopy />
            </ToolbarButton>
            <div className="relative">
              <ToolbarButton
                label={t("messageActions.more")}
                active={showMore}
                onClick={() => setShowMore((v) => !v)}
              >
                <IconMore />
              </ToolbarButton>
              {showMore && (
                <MoreMenu
                  isOwn={isOwn}
                  onClose={() => setShowMore(false)}
                  onEdit={() => {
                    setShowMore(false);
                    setEditing(true);
                  }}
                  onDelete={() => {
                    setShowMore(false);
                    void deleteMessage();
                  }}
                  onPin={() => {
                    setShowMore(false);
                    void pinMessage();
                  }}
                  onMarkUnread={() => {
                    setShowMore(false);
                    void markUnread();
                  }}
                  onCopyLink={() => {
                    setShowMore(false);
                    void copyLink();
                  }}
                />
              )}
            </div>
          </Toolbar>
        </div>
      )}
      {pickerAnchor && (
        <PopoverPortal anchor={pickerAnchor} placement="top-start">
          <EmojiPicker
            onPick={(emoji) => {
              setPickerAnchor(null);
              void toggleReaction(emoji);
            }}
            onClose={() => setPickerAnchor(null)}
          />
        </PopoverPortal>
      )}
    </div>
  );
}

function MoreMenu({
  isOwn,
  onClose,
  onEdit,
  onDelete,
  onPin,
  onMarkUnread,
  onCopyLink,
}: {
  isOwn: boolean;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onPin: () => void;
  onMarkUnread: () => void;
  onCopyLink: () => void;
}) {
  const { t } = useTranslator();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose]);
  return (
    <div
      ref={ref}
      className="absolute right-0 top-full z-40 mt-1 w-52 overflow-hidden rounded-md border border-border bg-card shadow-xl"
    >
      <MenuItem icon={<IconPin />} label={t("messageActions.pin")} onClick={onPin} />
      <MenuItem
        icon={<IconBookmark />}
        label={t("messageActions.markUnread")}
        onClick={onMarkUnread}
      />
      <MenuItem icon={<IconCopy />} label={t("messageActions.copyLink")} onClick={onCopyLink} />
      {isOwn && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuItem icon={<IconPencil />} label={t("messageActions.edit")} onClick={onEdit} />
          <MenuItem
            icon={<IconTrash />}
            label={t("messageActions.delete")}
            tone="danger"
            onClick={onDelete}
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  tone,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  tone?: "danger";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-hover ${
        tone === "danger" ? "text-destructive" : "text-foreground"
      }`}
    >
      <span className={tone === "danger" ? "text-destructive" : "text-secondary"}>{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function EmptyChannelState({ channelId }: { channelId: string }) {
  const channel = useSync((s) => s.channels[channelId]);
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const { t } = useTranslator();
  if (!channel) {
    return <p className="text-sm text-tertiary">{t("messageList.empty")}</p>;
  }
  const isDm = channel.type === "dm" || channel.type === "group_dm";
  if (isDm) {
    const memberIds = (channel.members && channel.members.length > 0)
      ? channel.members.filter((p) => p && p !== me)
      : channel.name.includes(":")
        ? channel.name.split(":").filter((p) => p && p !== me)
        : [];
    const partnerId = memberIds[0] ?? null;
    return <DmEmptyState partnerId={partnerId} />;
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <span className="text-3xl text-accent">#</span>
      <h2 className="text-lg font-semibold text-foreground">
        {t("messageList.welcomeToChannel", { name: channel.name })}
      </h2>
      <p className="max-w-md text-sm text-secondary">
        {t("messageList.channelStart", { name: channel.name })}
      </p>
      {channel.topic && (
        <p className="max-w-md text-xs text-tertiary">{channel.topic}</p>
      )}
    </div>
  );
}

function DmEmptyState({ partnerId }: { partnerId: string | null }) {
  const partnerName = useDisplayName(partnerId ?? "");
  const { t } = useTranslator();
  const label = partnerName || (partnerId ? partnerId : t("sidebar.directMessage"));
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <Avatar name={label} kind="human" size={40} />
      <h2 className="text-lg font-semibold text-foreground">{label}</h2>
      <p className="max-w-md text-sm text-secondary">
        {t("messageList.dmStart", { name: label })}
      </p>
    </div>
  );
}

function ReactionChip({
  emoji,
  users,
  meId,
  onClick,
}: {
  emoji: string;
  users: string[];
  meId: string | null;
  onClick: () => void;
}) {
  const usersById = useUsers((s) => s.byId);
  const { t } = useTranslator();
  const mine = meId ? users.includes(meId) : false;
  const names = users
    .map((id) => (id === meId ? t("messageActions.you") : usersById[id]?.display_name ?? id))
    .slice(0, 3)
    .join(", ");
  const tooltip =
    users.length > 3
      ? `${names} ${t("messageActions.andOthers", { n: users.length - 3 })}`
      : names;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      aria-label={`${emoji} ${users.length}`}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs transition-all duration-100 ${
        mine
          ? "border-accent/40 bg-accent-light text-accent"
          : "border-border bg-card text-secondary hover:border-accent/30 hover:bg-hover hover:text-foreground"
      }`}
    >
      <span aria-hidden="true">{emoji}</span>
      <span className="font-medium tabular-nums">{users.length}</span>
    </button>
  );
}

function MarkdownContent({ content, mentions }: { content: string; mentions: string[] }) {
  const usersById = useUsers((s) => s.byId);
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
    <div className="collab-prose max-w-none break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{enhanced}</ReactMarkdown>
    </div>
  );
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatHoverTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function sameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

function formatDateLabel(ts: number, t: (key: string) => string): string {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (sameDay(ts, today.getTime())) return t("messageList.today");
  if (sameDay(ts, yesterday.getTime())) return t("messageList.yesterday");
  const diffDays = Math.round((today.getTime() - ts) / (1000 * 60 * 60 * 24));
  if (diffDays < 7) {
    return d.toLocaleDateString(undefined, { weekday: "long" });
  }
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

