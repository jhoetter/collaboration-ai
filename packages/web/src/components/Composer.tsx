/**
 * Slack-style composer.
 *
 * - Plain-text contenteditable with markdown shortcuts (Cmd+B / Cmd+I /
 *   Cmd+E preview hints; we render markdown in MessageList).
 * - `@` triggers a user-suggest popover that walks `useUsers`.
 * - Drag/drop, paste, and a button reach the attachment tray which
 *   uploads files via `attachment:upload-init` + direct PUT to the
 *   presigned URL, then `attachment:upload-finalise`.
 * - Per-channel drafts persist to the server through `chat:set-draft`;
 *   typing emits a debounced `{type:typing}` frame over the WS.
 *
 * Lexical was the original target; we hand-roll on `contenteditable`
 * for deterministic mention/draft handling — Lexical's plugin set adds
 * a lot of bundle weight for marginal benefit at this scale.
 */
import { Button } from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { sendTypingFrame } from "../hooks/useEventStream.ts";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type Attachment } from "../state/sync.ts";
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

export function Composer({ channelId, threadRoot = null, placeholder, onSend }: ComposerProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<PendingAttachment[]>([]);
  const [showEmoji, setShowEmoji] = useState(false);
  const [mentionState, setMentionState] = useState<{ query: string; index: number } | null>(null);
  const draftFromServer = useSync((s) => s.draftsByChannel[channelId]?.content ?? "");
  const draftHydrated = useRef(false);
  const lastTypingSentAt = useRef(0);
  const lastDraftSavedAt = useRef(0);
  const draftSaveTimer = useRef<number | null>(null);

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
    if (editorRef.current) editorRef.current.textContent = "";
  }, [channelId]);

  function persistDraft(content: string) {
    const now = Date.now();
    if (draftSaveTimer.current) window.clearTimeout(draftSaveTimer.current);
    draftSaveTimer.current = window.setTimeout(() => {
      lastDraftSavedAt.current = now;
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

  function handleInput(e: React.FormEvent<HTMLDivElement>) {
    const value = (e.currentTarget.textContent ?? "").replace(/\u00a0/g, " ");
    setText(value);
    persistDraft(value);
    const now = Date.now();
    if (now - lastTypingSentAt.current > 2_000) {
      lastTypingSentAt.current = now;
      sendTypingFrame(channelId);
    }
    // Mention auto-complete: walk back from caret to `@` boundary.
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

  async function handleSend() {
    const trimmed = text.trim();
    const ready = pending.filter((p) => p.status === "ready");
    if (!trimmed && ready.length === 0) return;
    const mentions = collectMentionedUserIds(trimmed, userList);
    await onSend({
      text: trimmed,
      mentions,
      attachments: ready.map(({ status, localUrl, ...a }) => a),
      threadRoot,
    });
    setText("");
    setPending([]);
    if (editorRef.current) editorRef.current.textContent = "";
    persistDraft("");
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
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  function insertEmoji(emoji: string) {
    if (!editorRef.current) return;
    const next = (editorRef.current.textContent ?? "") + emoji;
    editorRef.current.textContent = next;
    setText(next);
    setShowEmoji(false);
    placeCaretAtEnd(editorRef.current);
  }

  return (
    <div
      className="border-t border-slate-800 bg-slate-900 p-2"
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
      <div className="rounded border border-slate-700 bg-slate-800 px-3 py-2">
        <div className="relative">
          <div
            ref={editorRef}
            role="textbox"
            aria-label="Message composer"
            contentEditable
            suppressContentEditableWarning
            onInput={handleInput}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            className="min-h-[40px] whitespace-pre-wrap break-words text-sm text-slate-100 outline-none"
          />
          {!text && (
            <div className="pointer-events-none absolute inset-0 text-sm text-slate-500">
              {placeholder ?? "Send a message"}
            </div>
          )}
          {mentionState && filteredUsers.length > 0 && (
            <ul className="absolute bottom-full left-0 z-10 mb-2 w-64 max-h-56 overflow-auto rounded border border-slate-700 bg-slate-900 shadow-xl">
              {filteredUsers.map((u, i) => (
                <li key={u.user_id}>
                  <button
                    type="button"
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                      i === mentionState.index ? "bg-slate-700" : "hover:bg-slate-800"
                    }`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      applyMention(u.user_id, u.display_name);
                    }}
                  >
                    <span className="font-medium text-slate-100">@{u.display_name}</span>
                    <span className="text-xs text-slate-500">{u.user_id}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <FilePickerButton onFile={uploadFile} />
          <button
            type="button"
            className="h-7 rounded px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
            aria-label="Add emoji"
            onClick={() => setShowEmoji((v) => !v)}
          >
            😀
          </button>
          {showEmoji && (
            <div className="absolute z-20 mt-1">
              <EmojiPicker onPick={insertEmoji} onClose={() => setShowEmoji(false)} />
            </div>
          )}
        </div>
        <Button
          variant="primary"
          size="sm"
          onClick={handleSend}
          disabled={!text.trim() && pending.filter((p) => p.status === "ready").length === 0}
        >
          Send
        </Button>
      </div>
    </div>
  );
}

function FilePickerButton({ onFile }: { onFile: (file: File) => void | Promise<void> }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        type="button"
        className="h-7 rounded px-2 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-100"
        onClick={() => ref.current?.click()}
        aria-label="Attach file"
      >
        📎
      </button>
      <input
        ref={ref}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          for (const f of files) void onFile(f);
          if (e.target) e.target.value = "";
        }}
      />
    </>
  );
}

function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const isImage = attachment.mime.startsWith("image/");
  return (
    <div className="flex items-center gap-2 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-200">
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
      {attachment.status === "uploading" && <span className="text-amber-400">uploading…</span>}
      {attachment.status === "error" && <span className="text-rose-400">failed</span>}
      <button
        type="button"
        className="text-slate-500 hover:text-rose-400"
        onClick={onRemove}
        aria-label="Remove attachment"
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
