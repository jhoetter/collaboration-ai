/**
 * Slack-style composer (Lexical-backed).
 *
 * Layout: optional formatting toolbar on top, Lexical-powered rich
 * content editable, action row (plus-menu, type, paperclip, smile,
 * mention, send) at the bottom.
 *
 * - WYSIWYG markdown via `@lexical/react`'s `MarkdownShortcutPlugin`:
 *   typing `**foo**` instantly bolds, `1. ` starts an ordered list,
 *   `> ` becomes a blockquote, etc. Cmd/Ctrl + B/I/E route through
 *   Lexical's `FORMAT_TEXT_COMMAND`.
 * - The chat protocol is markdown end-to-end, so we serialise to/from
 *   a markdown string for drafts (`chat:set-draft`) and the wire send
 *   payload (`chat:send-message`).
 * - `@` triggers a user-suggest popover; `/` at the start of an empty
 *   message opens the slash-command popover. Both popovers render
 *   through `PopoverPortal` so they escape the composer card and
 *   never get clipped.
 * - Drag/drop, paste, plus-menu and inline button reach the attachment
 *   tray which uploads files via `attachment:upload-init` + direct PUT
 *   to the presigned URL, then `attachment:upload-finalise`.
 * - Per-channel drafts persist to the server through `chat:set-draft`;
 *   typing emits a debounced `{type:typing}` frame over the WS.
 */
import {
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
import { $createLinkNode } from "@lexical/link";
import {
  $isListItemNode,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
} from "@lexical/list";
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import {
  $createCodeNode,
  $isCodeNode,
} from "@lexical/code";
import { $createQuoteNode, $isQuoteNode } from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  CLEAR_EDITOR_COMMAND,
  FORMAT_TEXT_COMMAND,
  type BaseSelection,
  type LexicalEditor,
} from "lexical";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sendTypingFrame } from "../hooks/useEventStream.ts";
import { callFunction } from "../lib/api.ts";
import { findBareLinks } from "../lib/autolink.ts";
import { useDialogs } from "../lib/dialogs.tsx";
import {
  hasEmojiShortcode,
  replaceEmojiShortcodes,
  replaceShortcodesInEditor,
  searchEmojiShortcodes,
  type EmojiSuggestion,
} from "../lib/emojiShortcodes.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";
import { PdfThumb, formatBytes } from "./AttachmentCard.tsx";
import { EmojiPicker } from "./EmojiPicker.tsx";
import { FileTypeIcon } from "./FileTypeIcon.tsx";
import { PopoverPortal } from "./PopoverPortal.tsx";
import { EditorSurface } from "./composer/EditorSurface.tsx";
import { buildEditorConfig } from "./composer/lexicalConfig.ts";
import {
  isMarkdownEmpty,
  readMarkdown,
  writeMarkdown,
} from "./composer/markdown.ts";

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
  /**
   * `true` when the command is meaningless without trailing arguments
   * (e.g. `/me <text>`). Picking such a command from the popover with
   * no args yet just autocompletes the name and waits for the user to
   * type the body instead of immediately sending or no-oping.
   */
  needsArgs?: boolean;
  /** Apply the command and return whether it was handled. `clear` resets the editor. */
  run(args: SlashRunArgs): SlashRunResult | Promise<SlashRunResult>;
}

interface SlashRunArgs {
  rest: string;
  channelId: string;
  setText(next: string): void;
  openNewDm(): void;
  openInvite(): void;
  setAway(): Promise<void>;
  pinLastOwnMessage(): Promise<void>;
}

type SlashRunResult = { handled: true; clear?: boolean } | { handled: false };

export function Composer(props: ComposerProps) {
  const config = useMemo(
    () => buildEditorConfig(`composer-${props.channelId}-${props.threadRoot ?? "main"}`),
    [props.channelId, props.threadRoot],
  );
  return (
    <LexicalComposer initialConfig={config}>
      <ComposerInner {...props} />
    </LexicalComposer>
  );
}

function ComposerInner({
  channelId,
  threadRoot = null,
  placeholder,
  onSend,
}: ComposerProps) {
  const { t } = useTranslator();
  const { linkPrompt } = useDialogs();
  const [editor] = useLexicalComposerContext();
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  // Inline link previews shown above the composer (Slack-style). Each
  // card has an X to dismiss; dismissed URLs go into
  // `dismissedUrlsRef` so re-triggering the same URL while the
  // composer is open doesn't immediately reinstate the preview.
  const [linkPreviews, setLinkPreviews] = useState<Attachment[]>([]);
  const linkPreviewsRef = useRef<Attachment[]>([]);
  linkPreviewsRef.current = linkPreviews;
  const dismissedUrlsRef = useRef<Set<string>>(new Set());
  const inflightUnfurlsRef = useRef<Set<string>>(new Set());
  const [showEmoji, setShowEmoji] = useState(false);
  // The formatting toolbar takes a row of vertical real estate that's a
  // luxury we can't afford on phones, so default it off below `md` and let
  // the user opt in via the `<IconType />` toggle.
  const [showFormatting, setShowFormatting] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    return window.matchMedia("(min-width: 768px)").matches;
  });
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [mentionState, setMentionState] = useState<{
    query: string;
    index: number;
    range: { node: Text; offset: number } | null;
  } | null>(null);
  const [slashState, setSlashState] = useState<{ query: string; index: number } | null>(
    null,
  );
  // Emoji shortcode autocomplete: `query` is the chars typed *after*
  // the triggering `:` (empty right after the user types `:`).
  const [emojiState, setEmojiState] = useState<{ query: string; index: number } | null>(
    null,
  );
  const draftFromServer = useSync((s) => s.draftsByChannel[channelId]?.content ?? "");
  const draftHydrated = useRef(false);
  const lastTypingSentAt = useRef(0);
  const draftSaveTimer = useRef<number | null>(null);
  const setNewDmOpen = useUi((s) => s.setNewDmOpen);
  const messagesByChannel = useSync((s) => s.messagesByChannel);
  const plusMenuButtonRef = useRef<HTMLButtonElement>(null);
  const emojiButtonRef = useRef<HTMLButtonElement>(null);
  const editorContainerRef = useRef<HTMLDivElement>(null);
  // Anchor for inline suggestion popovers (mention / slash / emoji).
  // We point them at the bordered composer card rather than the outer
  // wrapper so the popover's left edge aligns with the editor card,
  // not with the surrounding page padding.
  const composerCardRef = useRef<HTMLDivElement>(null);

  const usersById = useUsers((s) => s.byId);
  const userList = useMemo(() => Object.values(usersById), [usersById]);

  // Hydrate the editor with the persisted draft once on mount per channel.
  useEffect(() => {
    if (draftHydrated.current) return;
    if (draftFromServer) {
      writeMarkdown(editor, draftFromServer);
      setText(draftFromServer);
    }
    draftHydrated.current = true;
  }, [channelId, draftFromServer, editor]);

  // Reset hydrated flag when channel changes so we reload draft for new channel.
  useEffect(() => {
    draftHydrated.current = false;
    setText("");
    setPending([]);
    setLinkPreviews([]);
    dismissedUrlsRef.current = new Set();
    inflightUnfurlsRef.current = new Set();
    setSlashState(null);
    setMentionState(null);
    setEmojiState(null);
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
  }, [channelId, editor]);

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
  }, [channelId]);

  // Live link previews. Debounce against `text` so we don't hammer
  // `link:unfurl` while the user is mid-keystroke. The effect:
  //   1. Drops any preview whose URL has been deleted from the message.
  //   2. Fires `link:unfurl` for new URLs that aren't dismissed and
  //      aren't already loaded / in-flight, then appends them to the
  //      `linkPreviews` strip rendered above the editor.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      const urls = extractUrls(text);
      const wanted = new Set(urls);
      // Prune previews whose URL no longer appears in the body. Also
      // garbage-collect dismissed-URL bookkeeping so the user can
      // re-trigger a preview by retyping a URL after a full delete.
      setLinkPreviews((cur) => cur.filter((p) => p.url && wanted.has(p.url)));
      for (const dismissed of Array.from(dismissedUrlsRef.current)) {
        if (!wanted.has(dismissed)) dismissedUrlsRef.current.delete(dismissed);
      }
      for (const url of urls.slice(0, 3)) {
        if (dismissedUrlsRef.current.has(url)) continue;
        if (linkPreviewsRef.current.some((p) => p.url === url)) continue;
        if (inflightUnfurlsRef.current.has(url)) continue;
        inflightUnfurlsRef.current.add(url);
        void (async () => {
          try {
            const meta = await callFunction<{
              url: string;
              title: string | null;
              description: string | null;
              image_url: string | null;
              site_name: string | null;
            }>("link:unfurl", { url });
            if (!meta.title && !meta.description && !meta.image_url) return;
            // Re-check dismissal / presence after the await — the user
            // may have removed the URL or dismissed the preview while
            // the fetch was in flight.
            if (dismissedUrlsRef.current.has(url)) return;
            if (linkPreviewsRef.current.some((p) => p.url === url)) return;
            const att: Attachment = {
              file_id: `link_${hashUrl(url)}`,
              name: meta.title ?? url,
              mime: "text/url",
              size_bytes: 0,
              kind: "link_preview",
              url: meta.url,
              title: meta.title,
              description: meta.description,
              image_url: meta.image_url,
              site_name: meta.site_name,
            };
            setLinkPreviews((cur) =>
              cur.some((p) => p.url === url) ? cur : [...cur, att],
            );
          } catch {
            // Link previews are advisory; swallow so a failed unfurl
            // never blocks composition.
          } finally {
            inflightUnfurlsRef.current.delete(url);
          }
        })();
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [text]);

  function dismissLinkPreview(url: string) {
    dismissedUrlsRef.current.add(url);
    setLinkPreviews((cur) => cur.filter((p) => p.url !== url));
  }

  const persistDraft = useCallback(
    (content: string) => {
      if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = window.setTimeout(() => {
        const trimmed = content.trim();
        if (trimmed.length === 0) {
          void callFunction("chat:clear-draft", { channel_id: channelId }).catch(
            () => undefined,
          );
        } else {
          void callFunction("chat:set-draft", {
            channel_id: channelId,
            content: trimmed,
          }).catch(() => undefined);
        }
      }, 800);
    },
    [channelId],
  );

  const handleEditorChange = useCallback(
    (ed: LexicalEditor) => {
      // Slack-style `:shortcode:` → native emoji conversion. We mutate
      // the editor in place so the user sees the substitution as soon
      // as they close the second colon. The rewrite is idempotent so
      // the follow-up onChange this triggers is a no-op.
      if (hasEmojiShortcode(readMarkdown(ed))) {
        replaceShortcodesInEditor(ed);
      }
      const md = readMarkdown(ed);
      setText(md);
      persistDraft(md);
      const now = Date.now();
      if (now - lastTypingSentAt.current > 2_000 && !isMarkdownEmpty(md)) {
        lastTypingSentAt.current = now;
        sendTypingFrame(channelId);
      }
      // Slash commands only fire when the message begins with `/`.
      // We tolerate leading whitespace / blank paragraphs so a user who
      // typed-then-deleted earlier content still sees the popover.
      const slashHead = md.trimStart();
      if (slashHead.startsWith("/")) {
        const cmd = slashHead.slice(1).split(/\s/)[0]?.toLowerCase() ?? "";
        setSlashState({ query: cmd, index: 0 });
      } else {
        setSlashState(null);
      }
      // Mention + emoji detection: walk the current selection back to
      // the most recent trigger char (`@` or `:`) and extract the
      // query token. Both popovers anchor on the editor card, so they
      // never share a frame: the most recent trigger wins.
      ed.getEditorState().read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
          setMentionState(null);
          setEmojiState(null);
          return;
        }
        const anchor = selection.anchor;
        const node = anchor.getNode();
        const nodeText = node.getTextContent();
        const upTo = nodeText.slice(0, anchor.offset);

        const mention = upTo.match(/(^|\s)@([\w-]*)$/);
        if (mention) {
          setMentionState({
            query: mention[2].toLowerCase(),
            index: 0,
            range: null,
          });
        } else {
          setMentionState(null);
        }

        // Emoji trigger: a `:` at the start of the line or after
        // whitespace, followed by 0+ shortcode-allowed chars (and no
        // closing `:` — that path is handled by inline replacement).
        const emoji = upTo.match(/(^|\s):([a-z0-9_+\-]*)$/i);
        if (emoji && !mention) {
          setEmojiState({ query: emoji[2].toLowerCase(), index: 0 });
        } else {
          setEmojiState(null);
        }
      });
    },
    [channelId, persistDraft],
  );

  const filteredUsers = useMemo(() => {
    if (!mentionState) return [];
    const q = mentionState.query;
    return userList
      .filter(
        (u) =>
          u.user_id.toLowerCase().includes(q) ||
          u.display_name.toLowerCase().includes(q),
      )
      .slice(0, 6);
  }, [mentionState, userList]);

  const slashCommands: SlashCommand[] = useMemo(
    () => [
      {
        id: "me",
        name: "/me",
        hint: t("composer.slash.me"),
        needsArgs: true,
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

  const filteredEmoji = useMemo<EmojiSuggestion[]>(() => {
    if (!emojiState) return [];
    return searchEmojiShortcodes(emojiState.query, 8);
  }, [emojiState]);

  function applyMention(displayName: string) {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const anchor = selection.anchor;
      const node = anchor.getNode();
      if (node.getType() !== "text") return;
      const nodeText = node.getTextContent();
      const upTo = nodeText.slice(0, anchor.offset);
      const m = upTo.match(/@([\w-]*)$/);
      if (!m) return;
      const start = anchor.offset - m[0].length;
      const replacement = `@${displayName} `;
      // Replace [start, anchor.offset) with the mention text.
      const after = nodeText.slice(anchor.offset);
      (node as unknown as { setTextContent(t: string): void }).setTextContent(
        nodeText.slice(0, start) + replacement + after,
      );
      const newOffset = start + replacement.length;
      selection.anchor.set(node.getKey(), newOffset, "text");
      selection.focus.set(node.getKey(), newOffset, "text");
    });
    setMentionState(null);
  }

  function applyEmoji(native: string) {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) return;
      const anchor = selection.anchor;
      const node = anchor.getNode();
      if (node.getType() !== "text") return;
      const nodeText = node.getTextContent();
      const upTo = nodeText.slice(0, anchor.offset);
      // Strip the `:query` token (no closing colon) we replaced from
      // and splice the native emoji in its place.
      const m = upTo.match(/:([a-z0-9_+\-]*)$/i);
      if (!m) return;
      const start = anchor.offset - m[0].length;
      const after = nodeText.slice(anchor.offset);
      (node as unknown as { setTextContent(t: string): void }).setTextContent(
        nodeText.slice(0, start) + native + after,
      );
      const newOffset = start + native.length;
      selection.anchor.set(node.getKey(), newOffset, "text");
      selection.focus.set(node.getKey(), newOffset, "text");
    });
    setEmojiState(null);
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
    editor.dispatchCommand(CLEAR_EDITOR_COMMAND, undefined);
    setSlashState(null);
    setMentionState(null);
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
        writeMarkdown(editor, next);
        setText(next);
      },
      openNewDm: () => setNewDmOpen(true),
      openInvite: () => useUi.getState().setMembersPanelOpen(true),
      setAway,
      pinLastOwnMessage,
    };
    const result = await cmd.run(args);
    if (result.handled && result.clear) clearEditor();
    return result.handled;
  }

  async function dispatchSend(rawText: string) {
    const trimmed = replaceEmojiShortcodes(rawText.trim());
    const ready = pending.filter((p) => p.status === "ready");
    if (!trimmed && ready.length === 0) return;
    if (await maybeRunSlash(trimmed)) {
      const after = replaceEmojiShortcodes(readMarkdown(editor).trim());
      if (!after && ready.length === 0) return;
      const mentions = collectMentionedUserIds(after, userList);
      // Send any previews that survived the user's dismissals plus a
      // best-effort fetch for URLs that appeared too recently for the
      // debounced `useEffect` to have resolved them yet.
      const linkAttachments = await collectLinkPreviewsForSend(after);
      await onSend({
        text: after,
        mentions,
        attachments: [...ready.map(stripUploadFields), ...linkAttachments],
        threadRoot,
      });
      clearEditor();
      setPending([]);
      setLinkPreviews([]);
      dismissedUrlsRef.current = new Set();
      return;
    }
    const mentions = collectMentionedUserIds(trimmed, userList);
    const linkAttachments = await collectLinkPreviewsForSend(trimmed);
    await onSend({
      text: trimmed,
      mentions,
      attachments: [...ready.map(stripUploadFields), ...linkAttachments],
      threadRoot,
    });
    clearEditor();
    setPending([]);
    setLinkPreviews([]);
    dismissedUrlsRef.current = new Set();
  }

  /**
   * Build the list of `link_preview` attachments to ship with the
   * outgoing message:
   *
   *   1. Start with the previews the user actually sees in the
   *      composer (already filtered by their X-button dismissals).
   *   2. Top up with on-demand `link:unfurl` calls for URLs that
   *      appear in the text but haven't yet been fetched (e.g. the
   *      user typed a URL and hit Enter inside the 400 ms debounce
   *      window) and that haven't been dismissed.
   */
  async function collectLinkPreviewsForSend(content: string): Promise<Attachment[]> {
    const visible = linkPreviewsRef.current;
    const haveUrls = new Set(visible.map((p) => p.url ?? ""));
    const wanted = extractUrls(content);
    const missing = wanted.filter(
      (u) => !haveUrls.has(u) && !dismissedUrlsRef.current.has(u),
    );
    const fetched = missing.length > 0 ? await fetchLinkPreviews(missing) : [];
    return [...visible, ...fetched];
  }

  async function handleSend() {
    await dispatchSend(text);
  }

  /**
   * Confirm a slash-command suggestion (Enter on the popover or
   * mouse-click). For commands that need arguments we just complete
   * the name and let the user keep typing; otherwise we replace the
   * editor with the canonical form and run it through the send pipe
   * so the actual side effect (open dialog, set presence, etc.) fires.
   */
  async function pickSlashCommand(cmd: SlashCommand) {
    const cur = readMarkdown(editor).trimStart();
    const rest = cur.replace(/^\/\S*\s*/, "");
    if (cmd.needsArgs && !rest.trim()) {
      const next = `${cmd.name} `;
      writeMarkdown(editor, next);
      setText(next);
      setSlashState({ query: cmd.name.slice(1), index: 0 });
      return;
    }
    const candidate = rest ? `${cmd.name} ${rest}` : cmd.name;
    writeMarkdown(editor, candidate);
    setText(candidate);
    await dispatchSend(candidate);
  }

  async function fetchLinkPreviews(urls: string[]): Promise<Attachment[]> {
    if (urls.length === 0) return [];
    const out: Attachment[] = [];
    for (const url of urls.slice(0, 3)) {
      try {
        // The unfurl endpoint may include extras like `fetched_at` that
        // aren't part of the strict `Attachment` schema. Pick the OG
        // fields explicitly so a stray new field on the server can't
        // silently fail the whole `chat:send-message` validation.
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
          kind: "link_preview",
          url: meta.url,
          title: meta.title,
          description: meta.description,
          image_url: meta.image_url,
          site_name: meta.site_name,
        });
      } catch {
        // Link previews are advisory.
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
        if (pick) applyMention(pick.display_name);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionState(null);
        return;
      }
    }
    if (emojiState && filteredEmoji.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setEmojiState((s) =>
          s ? { ...s, index: Math.min(filteredEmoji.length - 1, s.index + 1) } : s,
        );
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setEmojiState((s) => (s ? { ...s, index: Math.max(0, s.index - 1) } : s));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        const pick = filteredEmoji[emojiState.index];
        if (pick) applyEmoji(pick.native);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setEmojiState(null);
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
        if (pick) {
          const cur = readMarkdown(editor);
          const tail = cur.replace(/^\/[\w-]*/, `${pick.name} `);
          writeMarkdown(editor, tail);
          setText(tail);
        }
        return;
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        const pick = filteredSlash[slashState.index];
        if (pick) void pickSlashCommand(pick);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setSlashState(null);
        return;
      }
    }
    const isMod = e.metaKey || e.ctrlKey;
    if (isMod && e.shiftKey && (e.key === "u" || e.key === "U")) {
      e.preventDefault();
      void promptLink();
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) {
      // Cmd/Ctrl+Enter is an explicit "send" override that fires even
      // when the cursor sits inside a list / code block / quote where
      // a bare Enter would otherwise extend the structure.
      if (isMod) {
        e.preventDefault();
        void handleSend();
        return;
      }
      // Inside a bullet/numbered list, fenced code block, or blockquote
      // the user is mid-thought: defer to Lexical's native Enter so we
      // get the next list item, a new line in code, etc. Empty list
      // items still exit the list (Lexical's built-in behaviour).
      if (isInsideStructuredBlock(editor)) {
        return;
      }
      e.preventDefault();
      void handleSend();
    }
  }

  function format(format: "bold" | "italic" | "underline" | "strikethrough" | "code") {
    editor.dispatchCommand(FORMAT_TEXT_COMMAND, format);
  }

  async function promptLink() {
    // Snapshot the live selection so we can restore it after the
    // prompt has stolen focus. `clone()` detaches it from the
    // editor's mutable state. The selected text (if any) becomes the
    // default label so the standard "select word → ⌘⇧U → paste URL"
    // flow Just Works.
    let selectedText = "";
    let savedSelection: BaseSelection | null = null;
    editor.getEditorState().read(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel)) {
        selectedText = sel.getTextContent();
        savedSelection = sel.clone();
      }
    });

    const result = await linkPrompt({ defaultLabel: selectedText });
    if (!result) return;

    editor.focus();
    editor.update(() => {
      if (savedSelection) $setSelection(savedSelection.clone());
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) {
        // Fallback: append at the end of the document so the user
        // doesn't lose their link if the editor somehow has no
        // selection (e.g. completely empty + never focused).
        const root = $getRoot();
        const last = root.getLastChild();
        const linkNode = $createLinkNode(result.url);
        linkNode.append($createTextNode(result.label || result.url));
        if (last && "append" in last && typeof last.append === "function") {
          (last as unknown as { append(...nodes: unknown[]): void }).append(linkNode);
        } else {
          const para = $createParagraphNode();
          para.append(linkNode);
          root.append(para);
        }
        return;
      }
      const linkNode = $createLinkNode(result.url);
      linkNode.append($createTextNode(result.label || result.url));
      // `insertNodes` replaces the selected range with our link, or
      // splices it in at the caret when the selection is collapsed.
      sel.insertNodes([linkNode]);
    });
  }

  function insertEmoji(emoji: string) {
    editor.update(() => {
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        selection.insertText(emoji);
      }
    });
    setShowEmoji(false);
  }

  function toggleQuote() {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const nodes = selection.getNodes();
      const inQuote = nodes.some((n) => $isQuoteNode(n.getTopLevelElementOrThrow()));
      $setBlocksType(selection, () =>
        inQuote ? $createParagraphNode() : $createQuoteNode(),
      );
    });
  }

  function insertCodeBlock() {
    editor.update(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection)) return;
      const nodes = selection.getNodes();
      const inCode = nodes.some((n) => $isCodeNode(n.getTopLevelElementOrThrow()));
      $setBlocksType(selection, () =>
        inCode ? $createParagraphNode() : $createCodeNode(),
      );
    });
  }

  function focusEditor() {
    editor.focus();
  }

  function appendAtMention() {
    editor.focus();
    editor.update(() => {
      const root = $getRoot();
      const last = root.getLastDescendant();
      const selection = $getSelection();
      if ($isRangeSelection(selection)) {
        if (last) {
          const lastText = last.getTextContent();
          const prefix = lastText && !lastText.endsWith(" ") ? " " : "";
          selection.insertText(`${prefix}@`);
        } else {
          selection.insertText("@");
        }
      }
    });
  }

  const canSend = text.trim().length > 0 || pending.some((p) => p.status === "ready");

  return (
    <div
      ref={editorContainerRef}
      className="relative px-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] md:px-4 md:pb-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {pending.length > 0 && (
        <div className="mb-3 flex flex-wrap items-start gap-2 rounded-md bg-hover/50 p-2">
          {pending.map((p) => (
            <AttachmentChip
              key={p.file_id}
              attachment={p}
              onRemove={() => setPending((all) => all.filter((a) => a.file_id !== p.file_id))}
            />
          ))}
        </div>
      )}
      {linkPreviews.length > 0 && (
        <div className="mb-3 flex flex-wrap items-start gap-2">
          {linkPreviews.map((p) => (
            <LinkPreviewChip
              key={p.file_id}
              attachment={p}
              onRemove={() => p.url && dismissLinkPreview(p.url)}
            />
          ))}
        </div>
      )}
      <div
        ref={composerCardRef}
        className="group/composer rounded-lg border border-border bg-background shadow-sm transition-all focus-within:border-accent/60 focus-within:shadow-md focus-within:ring-1 focus-within:ring-accent/20"
        onClick={focusEditor}
      >
        {showFormatting && (
          <Toolbar
            density="comfortable"
            className="gap-2 overflow-hidden rounded-t-lg border-b border-border/60 px-3 py-2"
            onClick={(e) => e.stopPropagation()}
          >
            <ToolbarButton
              label={t("composer.bold")}
              shortcut="⌘B"
              onClick={() => format("bold")}
            >
              <IconBold />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.italic")}
              shortcut="⌘I"
              onClick={() => format("italic")}
            >
              <IconItalic />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.strikethrough")}
              shortcut="⌘⇧X"
              onClick={() => format("strikethrough")}
            >
              <IconStrike />
            </ToolbarButton>
            <ToolbarButton label={t("composer.link")} shortcut="⌘⇧U" onClick={() => void promptLink()}>
              <IconLink />
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
              label={t("composer.bulletedList")}
              onClick={() =>
                editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
              }
            >
              <IconListBullet />
            </ToolbarButton>
            <ToolbarButton
              label={t("composer.numberedList")}
              onClick={() =>
                editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
              }
            >
              <IconListNumbered />
            </ToolbarButton>
            <ToolbarButton label={t("composer.quote")} onClick={toggleQuote}>
              <IconQuote />
            </ToolbarButton>
            <ToolbarDivider />
            <ToolbarButton
              label={t("composer.code")}
              shortcut="⌘E"
              onClick={() => format("code")}
            >
              <IconCode />
            </ToolbarButton>
            <ToolbarButton label={t("composer.codeBlock")} onClick={insertCodeBlock}>
              <IconCodeBlock />
            </ToolbarButton>
          </Toolbar>
        )}
        <div onClick={(e) => e.stopPropagation()}>
          <EditorSurface
            ariaLabel="Message composer"
            placeholder={placeholder ?? t("composer.placeholder")}
            onChange={handleEditorChange}
            onKeyDownCapture={handleKeyDown}
            onPaste={handlePaste}
          />
        </div>
        <div
          className="flex items-center gap-2 overflow-x-auto border-t border-border/60 px-3 pb-2.5 pt-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onClick={(e) => e.stopPropagation()}
        >
          <ToolbarButton
            ref={plusMenuButtonRef}
            label={t("composer.more")}
            onClick={() => setShowPlusMenu((v) => !v)}
            active={showPlusMenu}
          >
            <IconPlus />
          </ToolbarButton>
          <ToolbarDivider />
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
            ref={emojiButtonRef}
            label={t("composer.addEmoji")}
            active={showEmoji}
            onClick={() => setShowEmoji((v) => !v)}
          >
            <IconSmile />
          </ToolbarButton>
          <ToolbarButton label={t("composer.mention")} onClick={appendAtMention}>
            <IconAt />
          </ToolbarButton>
          <ToolbarSpacer />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canSend}
            aria-label={t("common.send")}
            title={`${t("common.send")} (⏎)`}
            className={`inline-flex h-8 w-8 flex-none items-center justify-center rounded-md transition-all md:h-7 md:w-7 ${
              canSend
                ? "bg-accent text-accent-foreground shadow-sm hover:brightness-110"
                : "bg-hover text-tertiary"
            } disabled:cursor-not-allowed`}
          >
            <IconSend size={14} />
          </button>
        </div>
      </div>

      {showPlusMenu && (
        <PopoverPortal anchor={plusMenuButtonRef.current} placement="bottom-start">
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
              appendAtMention();
            }}
          />
        </PopoverPortal>
      )}
      {mentionState && filteredUsers.length > 0 && (
        <PopoverPortal anchor={composerCardRef.current} placement="bottom-start">
          <ul className="max-h-56 w-[min(16rem,calc(100vw-1.5rem))] overflow-auto rounded-md border border-border bg-card shadow-xl">
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
                    applyMention(u.display_name);
                  }}
                >
                  <span className="font-medium text-foreground">@{u.display_name}</span>
                  <span className="text-xs text-tertiary">{u.user_id}</span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverPortal>
      )}
      {slashState && filteredSlash.length > 0 && (
        <PopoverPortal anchor={composerCardRef.current} placement="bottom-start">
          <ul className="max-h-64 w-[min(18rem,calc(100vw-1.5rem))] overflow-auto rounded-md border border-border bg-card shadow-xl">
            {filteredSlash.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm transition-colors ${
                    i === slashState.index ? "bg-accent-light text-accent" : "hover:bg-hover"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    void pickSlashCommand(c);
                  }}
                >
                  <span className="font-medium text-foreground">{c.name}</span>
                  <span className="text-xs text-tertiary">{c.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverPortal>
      )}
      {emojiState && filteredEmoji.length > 0 && (
        <PopoverPortal anchor={composerCardRef.current} placement="bottom-start">
          <ul className="max-h-64 w-[min(18rem,calc(100vw-1.5rem))] overflow-auto rounded-md border border-border bg-card shadow-xl">
            {filteredEmoji.map((s, i) => (
              <li key={s.shortcode}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-3 px-3 py-1.5 text-left text-sm transition-colors ${
                    i === emojiState.index
                      ? "bg-accent-light text-accent"
                      : "hover:bg-hover"
                  }`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    applyEmoji(s.native);
                  }}
                >
                  <span className="text-base leading-none" aria-hidden="true">
                    {s.native}
                  </span>
                  <span className="font-medium text-foreground">:{s.shortcode}:</span>
                </button>
              </li>
            ))}
          </ul>
        </PopoverPortal>
      )}
      {showEmoji && (
        <PopoverPortal anchor={emojiButtonRef.current} placement="bottom-start">
          <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
        </PopoverPortal>
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
      className="w-56 overflow-hidden rounded-md border border-border bg-card shadow-xl"
    >
      <PlusMenuItem
        icon={<IconPaperclip />}
        label={t("composer.actions.attach")}
        onClick={onAttach}
      />
      <PlusMenuItem
        icon={<IconCodeBlock />}
        label={t("composer.actions.snippet")}
        onClick={onSnippet}
      />
      <PlusMenuItem
        icon={<IconAt />}
        label={t("composer.actions.mention")}
        onClick={onMention}
      />
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
  const isPdf = attachment.mime === "application/pdf";
  const uploading = attachment.status === "uploading";
  const errored = attachment.status === "error";

  const removeButton = (
    <button
      type="button"
      onClick={onRemove}
      aria-label={t("composer.removeAttachment")}
      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-tertiary shadow-sm ring-1 ring-border transition-colors hover:bg-background hover:text-destructive"
    >
      <span aria-hidden="true" className="text-[11px] leading-none">✕</span>
    </button>
  );

  const statusOverlay = (uploading || errored) && (
    <div
      className={`pointer-events-none absolute inset-0 flex items-end justify-start p-1.5 text-[10px] font-medium ${
        errored ? "bg-destructive/10" : "bg-background/40"
      }`}
    >
      <span
        className={`rounded px-1.5 py-0.5 ${
          errored
            ? "bg-destructive text-destructive-foreground"
            : "bg-background/90 text-secondary ring-1 ring-border"
        }`}
      >
        {errored ? t("composer.uploadFailed") : t("composer.uploading")}
      </span>
    </div>
  );

  if (isImage && attachment.localUrl) {
    return (
      <div className="relative overflow-hidden rounded-md border border-border bg-card shadow-sm">
        <img
          src={attachment.localUrl}
          alt={attachment.name}
          className="block h-20 w-20 object-cover"
        />
        {statusOverlay}
        {removeButton}
      </div>
    );
  }

  if (isPdf) {
    return (
      <div className="relative flex w-full max-w-[16rem] items-stretch overflow-hidden rounded-md border border-border bg-card shadow-sm sm:w-64">
        <PdfThumb url={attachment.localUrl ?? null} size={64} />
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 p-2.5 pr-7 text-xs">
          <p className="truncate font-medium text-foreground">{attachment.name}</p>
          <p className="text-tertiary">PDF · {formatBytes(attachment.size_bytes)}</p>
        </div>
        {statusOverlay}
        {removeButton}
      </div>
    );
  }

  return (
    <div className="relative flex w-full max-w-[16rem] items-center gap-3 rounded-md border border-border bg-card p-2.5 pr-7 shadow-sm sm:w-64">
      <FileTypeIcon mime={attachment.mime} filename={attachment.name} size={36} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{attachment.name}</p>
        <p className="text-xs text-tertiary">{formatBytes(attachment.size_bytes)}</p>
      </div>
      {statusOverlay}
      {removeButton}
    </div>
  );
}

/**
 * Compact card the composer renders above the editor for each
 * resolved link preview. Mirrors the message-side `LinkPreviewCard`
 * but is non-clickable (we don't want clicks while composing) and
 * carries an X button for the user to dismiss the preview before
 * sending — Slack-style.
 */
function LinkPreviewChip({
  attachment,
  onRemove,
}: {
  attachment: Attachment;
  onRemove: () => void;
}) {
  const { t } = useTranslator();
  const meta = attachment as Attachment & {
    title?: string | null;
    description?: string | null;
    site_name?: string | null;
    image_url?: string | null;
    url?: string | null;
  };
  return (
    <div className="relative flex w-96 max-w-full overflow-hidden rounded-md border border-border bg-card pr-7 shadow-sm">
      <span className="w-1 shrink-0 bg-accent" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 text-xs">
        {meta.site_name && (
          <span className="truncate text-tertiary">{meta.site_name}</span>
        )}
        {meta.title && (
          <span className="truncate text-sm font-medium text-foreground">
            {meta.title}
          </span>
        )}
        {meta.description && (
          <span className="line-clamp-2 text-secondary">{meta.description}</span>
        )}
        {!meta.title && !meta.description && meta.url && (
          <span className="truncate text-secondary">{meta.url}</span>
        )}
      </div>
      {meta.image_url && (
        <img
          src={meta.image_url}
          alt={meta.title ?? ""}
          className="hidden max-h-24 w-32 flex-none object-cover sm:block"
          loading="lazy"
        />
      )}
      <button
        type="button"
        onClick={onRemove}
        aria-label={t("composer.removeLinkPreview")}
        className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-tertiary shadow-sm ring-1 ring-border transition-colors hover:bg-background hover:text-destructive"
      >
        <span aria-hidden="true" className="text-[11px] leading-none">✕</span>
      </button>
    </div>
  );
}

function stripUploadFields(att: PendingAttachment): Attachment {
  const { status: _status, localUrl: _localUrl, ...rest } = att;
  return rest;
}

/**
 * Walk up from the current selection to see whether the caret sits
 * inside a Lexical block where pressing Enter should extend the block
 * (next list item, new line in a code fence, new line in a blockquote)
 * rather than send the message.
 */
function isInsideStructuredBlock(editor: LexicalEditor): boolean {
  let inside = false;
  editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;
    let node: ReturnType<typeof selection.anchor.getNode> | null =
      selection.anchor.getNode();
    while (node) {
      if ($isListItemNode(node) || $isCodeNode(node) || $isQuoteNode(node)) {
        inside = true;
        return;
      }
      node = node.getParent();
    }
  });
  return inside;
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
      (u) =>
        u.display_name.toLowerCase() === candidate.toLowerCase() ||
        u.user_id.toLowerCase() === candidate.toLowerCase(),
    );
    if (direct) ids.add(direct.user_id);
  }
  return Array.from(ids);
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

/**
 * Collect every URL in a message body that we should try to unfurl.
 * Picks up both fully-qualified `https?://…` URLs and bare domains
 * (`hpi.de`, `example.com/about`) — the latter via `findBareLinks`,
 * which uses the same TLD allowlist that drives chat-side rendering
 * so the preview card always matches what the reader sees inline.
 */
function extractUrls(text: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  function add(url: string) {
    const cleaned = url.replace(/[)\].,!?;:]+$/g, "");
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  for (const raw of text.match(URL_RE) ?? []) add(raw);
  for (const m of findBareLinks(text)) add(m.url);
  return out;
}

function hashUrl(url: string): string {
  let h = 0;
  for (let i = 0; i < url.length; i++) {
    h = (h * 31 + url.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}
