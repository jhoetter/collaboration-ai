/**
 * Active thread store.
 *
 * Slack opens a right-rail pane when you click "Reply in thread"; we
 * mirror that with a single `activeThread` slot per workspace. The
 * underlying replies live in the regular `messagesByChannel` projection
 * (filtered by `thread_root === rootId`) so the rail just needs the
 * id of the root message — events stream in the same way as the main
 * timeline.
 */
import { create } from "zustand";

export interface ThreadState {
  rootId: string | null;
  open(rootId: string): void;
  close(): void;
}

export const useThread = create<ThreadState>((set) => ({
  rootId: null,
  open(rootId) {
    writeThreadQuery(rootId);
    set({ rootId });
  },
  close() {
    writeThreadQuery(null);
    set({ rootId: null });
  },
}));

function writeThreadQuery(rootId: string | null) {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== "/chat" && !window.location.pathname.startsWith("/chat/")) {
    return;
  }
  const params = new URLSearchParams(window.location.search);
  if (rootId) params.set("thread", rootId);
  else params.delete("thread");
  const q = params.toString();
  const next = q ? `${window.location.pathname}?${q}` : window.location.pathname;
  const current = `${window.location.pathname}${window.location.search}`;
  if (current === next) return;
  window.history.pushState({}, "", next);
  window.dispatchEvent(new Event("popstate"));
}
