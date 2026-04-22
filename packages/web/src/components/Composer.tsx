/**
 * Slack-style composer.
 *
 * Layout: optional formatting toolbar on top, contenteditable input,
 * action row (plus-menu, smile, mention, send) at the bottom.
 *
 * - Plain-text contenteditable with markdown shortcuts. Selection-aware
 *   formatting buttons wrap the current selection (Cmd/Ctrl + B / I / E
 *   work too).
 * - `@` triggers a user-suggest popover that walks `useUsers`.
 * - `/` at the start of an empty message opens a slash-command popover.
 * - Drag/drop, paste, plus-menu and inline button reach the attachment
 *   tray which uploads files via `attachment:upload-init` + direct PUT
 *   to the presigned URL, then `attachment:upload-finalise`.
 * - Per-channel drafts persist to the server through `chat:set-draft`;
 *   typing emits a debounced `{type:typing}` frame over the WS.
 *
 * Lexical was the original target; we hand-roll on `contenteditable`
 * for deterministic mention/draft handling — Lexical's plugin set adds
 * a lot of bundle weight for marginal benefit at this scale.
 */
import {
  Button,
  IconAt,
  IconBold,
  IconCode,
  IconCodeBlock,
  IconItalic,
  IconLink,
  IconListBullet,
  IconListNumbered,
  IconPaperclip,
  IconPlus,
  IconQuote,
  IconSend,
  IconSmile,
  IconStrike,
  IconType,
  Toolbar,
  ToolbarButton,
  ToolbarDivider,
  ToolbarSpacer,
} from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { sendTypingFrame } from "../hooks/useEventStream.ts";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";
import { EmojiPicker } from "./EmojiPicker.tsx";

export interface ComposerSendPayload {
  text: string;
  mentions: string[];
  attachments: Attachment[];
  threadRoot?: string | null;
}

export interface ComposerProps {
  channelId: string;
  threadRoot?: string | null;
  placeholder?: string;
  onSend: (payload: ComposerSendPayload) => void | Promise<void>;
}

interface UploadInitResponse {
  file_id: string;
  object_key: string;
  put_url: string;
  headers: Record<string, string>;
}

interface PendingAttachment extends Attachment {
  status: "uploading" | "ready" | "error";
  localUrl?: string;
}

interface SlashCommand {
  id: string;
  name: string;
  hint: string;
  /** Apply the command to the current text and return the next textbox content (or undefined to no-op). */
  run(args: SlashRunArgs): SlashRunResult | Promise<SlashRunResult>;
}

interface SlashRunArgs {
  /** Text after the slash command itself, e.g. "@alice hi" for "/dm @alice hi". */
  rest: string;
  channelId: string;
  setText(next: string): void;
  setMentionState(s: { query: string; index: number } | null): void;
  openNewDm(): void;
  openInvite(): void;
  setAway(): Promise<void>;
  pinLastOwnMessage(): Promise<void>;
}

type SlashRunResult = { handled: true; clear?: boolean } | { handled: false };

export function Composer({ channelId, threadRoot = null, placeholder, onSend }: ComposerProps) {
  const { t } = useTranslator();
  const editorRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showFormatting, setShowFormatting] = useState(true);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [mentionState, setMentionState] = useState<{ query: string; index: number } | null>(null);
  const [slashState, setSlashState] = useState<{ query: string; index: number } | null>(null);
  const draftFromServer = useSync((s) => s.draftsByChannel[channelId]?.content ?? "");
  const draftHydrated = useRef(false);
  const lastTypingSentAt = useRef(0);
  const draftSaveTimer = useRef<number | null>(null);
  const setNewDmOpen = useUi((s) => s.setNewDmOpen);
  const messagesByChannel = useSync((s) => s.messagesByChannel);

  const usersById = useUsers((s) => s.byId);
  const userList = useMemo(() => Object.values(usersById), [usersById]);

  // Hydrate the editor with the persisted draft once on mount per channel.
  useEffect(() => {
    if (draftHydrated.current) return;
    if (draftFromServer) {
      setText(draftFromServer);
      if (editorRef.current) editorRef.current.textContent = draftFromServer;
    }
    draftHydrated.current = true;
  }, [channelId, draftFromServer]);

  // Reset hydrated flag when channel changes so we reload draft for new channel.
  useEffect(() => {
    draftHydrated.current = false;
    setText("");
    setPending([]);
    setSlashState(null);
    setMentionState(null);
    if (editorRef.current) editorRef.current.textContent = "";
  }, [channelId]);

  // Listen for the channel-pane drag-drop overlay so the upload pipeline
  // is the single source of truth for attachment uploads.
  useEffect(() => {
    function onFiles(e: Event) {
      const detail = (e as CustomEvent<{ channelId: string; files: File[] }>).detail;
      if (!detail || detail.channelId !== channelId) return;
      for (const file of detail.files) void uploadFile(file);
    }
    window.addEventListener("collab:files-dropped", onFiles as EventListener);
    return () => window.removeEventListener("collab:files-dropped", onFiles as EventListener);
    // `uploadFile` is closed-over but stable enough — it doesn't depend on
    // any state that's bound at hook-call time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channelId]);

  function persistDraft(content: string) {
    if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = window.setTimeout(() => {
      const trimmed = content.trim();
      if (trimmed.length === 0) {
        void callFunction("chat:clear-draft", { channel_id: channelId }).catch(() => undefined);
      } else {
        void callFunction("chat:set-draft", { channel_id: channelId, content: trimmed }).catch(
          () => undefined,
        );
      }
    }, 800);
  }

  function syncFromEditor() {
    const value = (editorRef.current?.textContent ?? "").replace(/\u00a0/g, " ");
    setText(value);
    persistDraft(value);
  }

  function handleInput() {
    syncFromEditor();
    const now = Date.now();
    if (now - lastTypingSentAt.current > 2_000) {
      lastTypingSentAt.current = now;
      sendTypingFrame(channelId);
    }
    const value = editorRef.current?.textContent ?? "";
    if (value.startsWith("/")) {
      const cmd = value.slice(1).split(/\s/)[0]?.toLowerCase() ?? "";
      setSlashState({ query: cmd, index: 0 });
    } else {
      setSlashState(null);
    }
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      const nodeText = range.startContainer.textContent ?? "";
      const upTo = nodeText.slice(0, range.startOffset);
      const match = upTo.match(/@([\w-]*)$/);
      if (match) {
        setMentionState({ query: match[1].toLowerCase(), index: 0 });
        return;
      }
    }
    setMentionState(null);
  }

  const filteredUsers = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query;
    return userList
      .filter((u) =>
        u.user_id.toLowerCase().includes(q) || u.display_name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [mentionState, userList]);

  const slashCommands: SlashCommand[] = useMemo(
    () => [
      {
        id: "me",
        name: "/me",
        hint: t("composer.slash.me"),
        run: ({ rest, setText: write }) => {
          if (!rest.trim()) return { handled: false };
          write(`*${rest.trim()}*`);
          return { handled: true };
        },
      },
      {
        id: "shrug",
        name: "/shrug",
        hint: t("composer.slash.shrug"),
        run: ({ rest, setText: write }) => {
          const prefix = rest ? `${rest.trim()} ` : "";
          write(`${prefix}¯\\_(ツ)_/¯`);
          return { handled: true };
        },
      },
      {
        id: "pin",
        name: "/pin",
        hint: t("composer.slash.pin"),
        run: async ({ pinLastOwnMessage }) => {
          await pinLastOwnMessage();
          return { handled: true, clear: true };
        },
      },
      {
        id: "invite",
        name: "/invite",
        hint: t("composer.slash.invite"),
        run: ({ openInvite }) => {
          openInvite();
          return { handled: true, clear: true };
        },
      },
      {
        id: "dm",
        name: "/dm",
        hint: t("composer.slash.dm"),
        run: ({ openNewDm }) => {
          openNewDm();
          return { handled: true, clear: true };
        },
      },
      {
        id: "away",
        name: "/away",
        hint: t("composer.slash.away"),
        run: async ({ setAway }) => {
          await setAway();
          return { handled: true, clear: true };
        },
      },
    ],
    [t],
  );

  const filteredSlash = useMemo(() => {
    if (!slashState) return [];
    return slashCommands.filter((c) => c.name.startsWith(`/${slashState.query}`));
  }, [slashState, slashCommands]);

  function applyMention(userId: string, displayName: string) {
    if (!editorRef.current) return;
    const node = editorRef.current;
    const current = node.textContent ?? "";
    const replaced = current.replace(/@([\w-]*)$/, `@${displayName} `);
    node.textContent = replaced;
    setText(replaced);
    setMentionState(null);
    placeCaretAtEnd(node);
  }

  async function handlePaste(e: React.ClipboardEvent<HTMLDivElement>) {
    const files = Array.from(e.clipboardData.files ?? []);
    if (files.length === 0) return;
    e.preventDefault();
    for (const file of files) await uploadFile(file);
  }

  async function handleDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files ?? []);
    for (const file of files) await uploadFile(file);
  }

  async function uploadFile(file: File) {
    const tmpId = `tmp_${crypto.randomUUID()}`;
    const localUrl = URL.createObjectURL(file);
    setPending((p) => [
      ...p,
      {
        file_id: tmpId,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
        status: "uploading",
        localUrl,
      },
    ]);
    try {
      const init = await callFunction<UploadInitResponse>("attachment:upload-init", {
        mime: file.type || "application/octet-stream",
      });
      const putRes = await fetch(init.put_url, {
        method: "PUT",
        headers: init.headers,
        body: file,
      });
      if (!putRes.ok) throw new Error(`upload PUT ${putRes.status}`);
      let dimensions: { width?: number; height?: number } = {};
      if (file.type.startsWith("image/")) {
        dimensions = await readImageDimensions(localUrl);
      }
      await callFunction("attachment:upload-finalise", {
        file_id: init.file_id,
        object_key: init.object_key,
        mime: file.type || "application/octet-stream",
        size_bytes: file.size,
        ...(dimensions.width ? { width: dimensions.width } : {}),
        ...(dimensions.height ? { height: dimensions.height } : {}),
      });
      setPending((p) =>
        p.map((a) =>
          a.file_id === tmpId
            ? {
                ...a,
                file_id: init.file_id,
                width: dimensions.width ?? null,
                height: dimensions.height ?? null,
                status: "ready",
              }
            : a,
        ),
      );
    } catch (err) {
      console.error("upload failed", err);
      setPending((p) => p.map((a) => (a.file_id === tmpId ? { ...a, status: "error" } : a)));
    }
  }

  async function pinLastOwnMessage() {
    const list = messagesByChannel[channelId] ?? [];
    const myId = useAuth.getState().identity?.user_id ?? null;
    const last = [...list].reverse().find((m) => myId && m.sender_id === myId && !m.redacted);
    if (!last) return;
    await callFunction("chat:pin-message", { target_event_id: last.id }).catch(() => undefined);
  }

  async function setAway() {
    await callFunction("user:set-presence", { status: "away" }).catch(() => undefined);
  }

  function clearEditor() {
    setText("");
    if (editorRef.current) editorRef.current.textContent = "";
    setSlashState(null);
    persistDraft("");
  }

  async function maybeRunSlash(rawText: string): Promise<boolean> {
    const trimmed = rawText.trim();
    if (!trimmed.startsWith("/")) return false;
    const head = trimmed.split(/\s/, 1)[0];
    const rest = trimmed.slice(head.length).trim();
    const cmd = slashCommands.find((c) => c.name === head);
    if (!cmd) return false;
    const args: SlashRunArgs = {
      rest,
      channelId,
      setText: (next) => {
        if (editorRef.current) editorRef.current.textContent = next;
        setText(next);
        placeCaretAtEnd(editorRef.current!);
      },
      setMentionState,
      openNewDm: () => setNewDmOpen(true),
      openInvite: () => useUi.getState().setMembersPanelOpen(true),
      setAway,
      pinLastOwnMessage,
    };
    const result = await cmd.run(args);
    if (result.handled && result.clear) clearEditor();
    return result.handled;
  }

  async function handleSend() {
    const trimmed = text.trim();
    const ready = pending.filter((p) => p.status === "ready");
    if (!trimmed && ready.length === 0) return;
    if (await maybeRunSlash(trimmed)) {
      const after = (editorRef.current?.textContent ?? "").trim();
      if (!after && ready.length === 0) return;
      const mentions = collectMentionedUserIds(after, userList);
      const linkAttachments = await fetchLinkPreviews(after);
      await onSend({
        text: after,
        mentions,
        attachments: [
          ...ready.map(({ status, localUrl, ...a }) => a),
          ...linkAttachments,
        ],
        threadRoot,
      });
      clearEditor();
      setPending([]);
      return;
    }
    const mentions = collectMentionedUserIds(trimmed, userList);
    const linkAttachments = await fetchLinkPreviews(trimmed);
    await onSend({
      text: trimmed,
      mentions,
      attachments: [
        ...ready.map(({ status, localUrl, ...a }) => a),
        ...linkAttachments,
      ],
      threadRoot,
    });
    clearEditor();
    setPending([]);
  }

  async function fetchLinkPreviews(content: string): Promise<Attachment[]> {
    const urls = extractUrls(content);
    if (urls.length === 0) return [];
    const out: Attachment[] = [];
    for (const url of urls.slice(0, 3)) {
      try {
        const meta = await callFunction<{
          url: string;
          title: string | null;
          description: string | null;
          image_url: string | null;
          site_name: string | null;
        }>("link:unfurl", { url });
        if (!meta.title && !meta.description && !meta.image_url) continue;
        out.push({
          file_id: `link_${hashUrl(url)}`,
          name: meta.title ?? url,
          mime: "text/url",
          size_bytes: 0,
          // The frontend AttachmentCard widens the type via a runtime
          // duck-type check (`kind === "link_preview"`), so casting here
          // is safe and avoids leaking the union into the canonical
          // backend `Attachment` schema.
          ...(meta as object),
          kind: "link_preview",
        } as Attachment);
      } catch {
        // Link previews are advisory — never block the send on a fetch
        // failure (private links, dead servers, captchas, …).
      }
    }
    return out;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (mentionState && filteredUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionState((s) =>
          s ? { ...s, index: Math.min(filteredUsers.length - 1, s.index + 1) } : s,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionState((s) => (s ? { ...s, index: Math.max(0, s.index - 1) } : s));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = filteredUsers[mentionState.index];
        if (pick) applyMention(pick.user_id, pick.display_name);
        return;
      }
      if (e.key === "Escape") {
        setMentionState(null);
        return;
      }
    }
    if (slashState && filteredSlash.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashState((s) =>
          s ? { ...s, index: Math.min(filteredSlash.length - 1, s.index + 1) } : s,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashState((s) => (s ? { ...s, index: Math.max(0, s.index - 1) } : s));
        return;
      }
      if (e.key === "Tab") {
        e.preventDefault();
        const pick = filteredSlash[slashState.index];
        if (pick && editorRef.current) {
          const cur = editorRef.current.textContent ?? "";
          const tail = cur.replace(/^\/[\w-]*/, `${pick.name} `);
          editorRef.current.textContent = tail;
          setText(tail);
          placeCaretAtEnd(editorRef.current);
        }
        return;
      }
      if (e.key === "Escape") {
        setSlashState(null);
        return;
      }
    }
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && (e.key === "b" || e.key === "B")) {
      e.preventDefault();
      wrapSelection("**", "**");
      return;
    }
    if (isMod && (e.key === "i" || e.key === "I")) {
      e.preventDefault();
      wrapSelection("*", "*");
      return;
    }
    if (isMod && (e.key === "e" || e.key === "E")) {
      e.preventDefault();
      wrapSelection("`", "`");
      return;
    }
    if (isMod && e.shiftKey && (e.key === "x" || e.key === "X")) {
      e.preventDefault();
      wrapSelection("~~", "~~");
      return;
    }
    if (isMod && (e.key === "k" || e.key === "K")) {
      e.preventDefault();
      promptLink();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function getSelectionInEditor(): { start: number; end: number } {
    const node = editorRef.current;
    if (!node) return { start: 0, end: 0 };
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) {
      const len = node.textContent?.length ?? 0;
      return { start: len, end: len };
    }
    const range = sel.getRangeAt(0);
    const pre = range.cloneRange();
    pre.selectNodeContents(node);
    pre.setEnd(range.startContainer, range.startOffset);
    const start = pre.toString().length;
    const end = start + range.toString().length;
    return { start, end };
  }

  function setSelectionInEditor(start: number, end: number) {
    const node = editorRef.current;
    if (!node) return;
    const range = document.createRange();
    let remaining = start;
    let endRemaining = end;
    let startSet = false;
    let endSet = false;
    function walk(n: Node) {
      if (startSet && endSet) return;
      if (n.nodeType === Node.TEXT_NODE) {
        const len = (n.textContent ?? "").length;
        if (!startSet && remaining <= len) {
          range.setStart(n, remaining);
          startSet = true;
        }
        if (!endSet && endRemaining <= len) {
          range.setEnd(n, endRemaining);
          endSet = true;
        }
        remaining -= len;
        endRemaining -= len;
      } else {
        for (const child of Array.from(n.childNodes)) walk(child);
      }
    }
    walk(node);
    if (!startSet || !endSet) {
      range.selectNodeContents(node);
      range.collapse(false);
    }
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }

  function wrapSelection(prefix: string, suffix: string, fallback?: string) {
    const node = editorRef.current;
    if (!node) return;
    node.focus();
    const cur = node.textContent ?? "";
    const { start, end } = getSelectionInEditor();
    const selected = cur.slice(start, end) || fallback || "";
    const next = cur.slice(0, start) + prefix + selected + suffix + cur.slice(end);
    node.textContent = next;
    setText(next);
    persistDraft(next);
    const newStart = start + prefix.length;
    const newEnd = newStart + selected.length;
    setSelectionInEditor(newStart, newEnd);
  }

  function prefixLines(prefix: string | ((index: number) => string)) {
    const node = editorRef.current;
    if (!node) return;
    node.focus();
    const cur = node.textContent ?? "";
    const { start, end } = getSelectionInEditor();
    const lineStart = cur.lastIndexOf("\n", Math.max(0, start - 1)) + 1;
    const lineEnd = cur.indexOf("\n", end);
    const tailIndex = lineEnd === -1 ? cur.length : lineEnd;
    const before = cur.slice(0, lineStart);
    const block = cur.slice(lineStart, tailIndex);
    const after = cur.slice(tailIndex);
    const lines = block.length === 0 ? [""] : block.split("\n");
    const transformed = lines
      .map((line, i) => `${typeof prefix === "string" ? prefix : prefix(i)}${line}`)
      .join("\n");
    const next = before + transformed + after;
    node.textContent = next;
    setText(next);
    persistDraft(next);
    setSelectionInEditor(before.length, before.length + transformed.length);
  }

  function promptLink() {
    const url = window.prompt(t("composer.linkPrompt"), "https://");
    if (!url) return;
    wrapSelection("[", `](${url})`, t("composer.link"));
  }

  function insertEmoji(emoji: string) {
    if (!editorRef.current) return;
    const next = (editorRef.current.textContent ?? "") + emoji;
    editorRef.current.textContent = next;
    setText(next);
    setShowEmoji(false);
    placeCaretAtEnd(editorRef.current);
  }

  function insertCodeBlock() {
    const node = editorRef.current;
    if (!node) return;
    const cur = node.textContent ?? "";
    const next = `${cur}${cur && !cur.endsWith("\n") ? "\n" : ""}\`\`\`\n\n\`\`\``;
    node.textContent = next;
    setText(next);
    persistDraft(next);
    placeCaretAtEnd(node);
  }

  const canSend = text.trim().length > 0 || pending.some((p) => p.status === "ready");

  return (
    <div
      className="border-t border-border bg-surface p-3"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {pending.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-2">
          {pending.map((p) => (
            <AttachmentChip
              key={p.file_id}
              attachment={p}
              onRemove={() => setPending((all) => all.filter((a) => a.file_id !== p.file_id))}
            />
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-md border border-border bg-background transition-colors focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/20">
        {showFormatting && (
          <Toolbar density="compact" className="border-b border-border px-2 py-1">
            <ToolbarButton
              label={t("composer.bold")}
              shortcut="⌘B"
              onClick={() => wrapSelection("**", "**")}
            >
              <IconBold />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.italic")}
              shortcut="⌘I"
              onClick={() => wrapSelection("*", "*")}
            >
              <IconItalic />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.strikethrough")}
              shortcut="⌘⇧X"
              onClick={() => wrapSelection("~~", "~~")}
            >
              <IconStrike />
            </ToolbarButton>
            <ToolbarButton label={t("composer.link")} shortcut="⌘K" onClick={promptLink}>
              <IconLink />
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
              label={t("composer.bulletedList")}
              onClick={() => prefixLines("- ")}
            >
              <IconListBullet />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.numberedList")}
              onClick={() => prefixLines((i) => `${i + 1}. `)}
            >
              <IconListNumbered />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.quote")}
              onClick={() => prefixLines("> ")}
            >
              <IconQuote />
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
              label={t("composer.code")}
              shortcut="⌘E"
              onClick={() => wrapSelection("`", "`")}
            >
              <IconCode />
            </ToolbarButton>
            <ToolbarButton label={t("composer.codeBlock")} onClick={insertCodeBlock}>
              <IconCodeBlock />
            </ToolbarButton>
          </Toolbar>
        )}
        <div className="relative px-3 py-2">
          <div
            ref={editorRef}
            role="textbox"
            aria-label="Message composer"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[40px] whitespace-pre-wrap break-words text-sm text-foreground outline-none"
          />
          {!text && (
            <div className="pointer-events-none absolute left-3 right-3 top-2 text-sm text-tertiary">
              {placeholder ?? t("composer.placeholder")}
            </div>
          )}
          {mentionState && filteredUsers.length > 0 && (
            <ul className="absolute bottom-full left-0 z-10 mb-2 w-64 max-h-56 overflow-auto rounded-md border border-border bg-card shadow-xl">
              {filteredUsers.map((u, i) => (
                <li key={u.user_id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                      i === mentionState.index
                        ? "bg-accent-light text-accent"
                        : "hover:bg-hover"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(u.user_id, u.display_name);
                    }}
                  >
                    <span className="font-medium text-foreground">@{u.display_name}</span>
                    <span className="text-xs text-tertiary">{u.user_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {slashState && filteredSlash.length > 0 && (
            <ul className="absolute bottom-full left-0 z-10 mb-2 w-72 max-h-64 overflow-auto rounded-md border border-border bg-card shadow-xl">
              {filteredSlash.map((c, i) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                      i === slashState.index ? "bg-accent-light text-accent" : "hover:bg-hover"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      if (editorRef.current) {
                        const cur = editorRef.current.textContent ?? "";
                        const tail = cur.replace(/^\/[\w-]*/, `${c.name} `);
                        editorRef.current.textContent = tail;
                        setText(tail);
                        placeCaretAtEnd(editorRef.current);
                      }
                    }}
                  >
                    <span className="font-medium text-foreground">{c.name}</span>
                    <span className="text-xs text-tertiary">{c.hint}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex items-center gap-1 border-t border-border px-2 py-1.5">
          <div className="relative">
            <ToolbarButton
              label={t("composer.more")}
              onClick={() => setShowPlusMenu((v) => !v)}
              active={showPlusMenu}
            >
              <IconPlus />
            </ToolbarButton>
            {showPlusMenu && (
              <PlusMenu
                onClose={() => setShowPlusMenu(false)}
                onAttach={() => {
                  setShowPlusMenu(false);
                  document.getElementById(`composer-file-${channelId}`)?.click();
                }}
                onSnippet={() => {
                  setShowPlusMenu(false);
                  insertCodeBlock();
                }}
                onMention={() => {
                  setShowPlusMenu(false);
                  if (editorRef.current) {
                    const cur = editorRef.current.textContent ?? "";
                    const next = `${cur}${cur && !cur.endsWith(" ") ? " " : ""}@`;
                    editorRef.current.textContent = next;
                    setText(next);
                    placeCaretAtEnd(editorRef.current);
                    setMentionState({ query: "", index: 0 });
                  }
                }}
              />
            )}
          </div>
          <ToolbarButton
            label={showFormatting ? t("composer.hideFormatting") : t("composer.showFormatting")}
            active={showFormatting}
            onClick={() => setShowFormatting((v) => !v)}
          >
            <IconType />
          </ToolbarButton>
          <ToolbarButton
            label={t("composer.attachFile")}
            onClick={() => document.getElementById(`composer-file-${channelId}`)?.click()}
          >
            <IconPaperclip />
          </ToolbarButton>
          <ToolbarButton
            label={t("composer.addEmoji")}
            active={showEmoji}
            onClick={() => setShowEmoji((v) => !v)}
          >
            <IconSmile />
          </ToolbarButton>
          <ToolbarButton
            label={t("composer.mention")}
            onClick={() => {
              if (editorRef.current) {
                const cur = editorRef.current.textContent ?? "";
                const next = `${cur}${cur && !cur.endsWith(" ") ? " " : ""}@`;
                editorRef.current.textContent = next;
                setText(next);
                placeCaretAtEnd(editorRef.current);
                setMentionState({ query: "", index: 0 });
              }
            }}
          >
            <IconAt />
          </ToolbarButton>
          <ToolbarSpacer />
          <Button
            variant="primary"
            size="sm"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-label={t("common.send")}
            className="gap-1.5"
          >
            <IconSend size={14} />
            <span>{t("common.send")}</span>
          </Button>
        </div>
      </div>
      {showEmoji && (
        <div className="absolute z-20 mt-1">
          <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
        </div>
      )}
      <input
        id={`composer-file-${channelId}`}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) void uploadFile(f);
          if (e.target) e.target.value = "";
        }}
      />
    </div>
  );
}

function PlusMenu({
  onClose,
  onAttach,
  onSnippet,
  onMention,
}: {
  onClose: () => void;
  onAttach: () => void;
  onSnippet: () => void;
  onMention: () => void;
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
      className="absolute bottom-full left-0 z-30 mb-2 w-56 overflow-hidden rounded-md border border-border bg-card shadow-xl"
    >
      <PlusMenuItem icon={<IconPaperclip />} label={t("composer.actions.attach")} onClick={onAttach} />
      <PlusMenuItem icon={<IconCodeBlock />} label={t("composer.actions.snippet")} onClick={onSnippet} />
      <PlusMenuItem icon={<IconAt />} label={t("composer.actions.mention")} onClick={onMention} />
    </div>
  );
}

function PlusMenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground transition-colors hover:bg-hover"
    >
      <span className="text-secondary">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const { t } = useTranslator();
  const isImage = attachment.mime.startsWith("image/");
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground">
      {isImage && attachment.localUrl ? (
        <img
          src={attachment.localUrl}
          alt={attachment.name}
          className="h-6 w-6 rounded object-cover"
        />
      ) : (
        <span aria-hidden="true">📄</span>
      )}
      <span className="max-w-[12rem] truncate">{attachment.name}</span>
      {attachment.status === "uploading" && (
        <span className="text-warning">{t("composer.uploading")}</span>
      )}
      {attachment.status === "error" && (
        <span className="text-destructive">{t("composer.uploadFailed")}</span>
      )}
      <button
        type="button"
        className="text-tertiary transition-colors hover:text-destructive"
        onClick={onRemove}
        aria-label={t("composer.removeAttachment")}
      >
        ✕
      </button>
    </div>
  );
}

function placeCaretAtEnd(el: HTMLElement) {
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = window.getSelection();
  sel?.removeAllRanges();
  sel?.addRange(range);
  el.focus();
}

function readImageDimensions(url: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 0, height: 0 });
    img.src = url;
  });
}

function collectMentionedUserIds(
  text: string,
  users: Array<{ user_id: string; display_name: string }>,
): string[] {
  const ids = new Set<string>();
  const regex = /@([\w-]+(?:\s[\w-]+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text))) {
    const candidate = m[1];
    const direct = users.find(
      (u) => u.display_name.toLowerCase() === candidate.toLowerCase() ||
        u.user_id.toLowerCase() === candidate.toLowerCase(),
    );
    if (direct) ids.add(direct.user_id);
  }
  return Array.from(ids);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

function extractUrls(text: string): string[] {
  const hits = text.match(URL_RE) ?? [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of hits) {
    const cleaned = raw.replace(/[)\].,!?;:]+$/g, "");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h * 31 + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
