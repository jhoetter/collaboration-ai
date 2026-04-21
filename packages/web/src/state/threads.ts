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
    set({ rootId });
  },
  close() {
    set({ rootId: null });
  },
}));
