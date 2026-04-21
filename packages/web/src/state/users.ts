/**
 * Cache of `user_id → display_name` for the active workspace.
 *
 * Hydrated once on workspace mount via `users:list`, then refreshed
 * lazily whenever a message arrives from a sender we haven't seen
 * before (e.g. a brand-new browser joined after this tab loaded).
 *
 * Names are best-effort: `useDisplayName` falls back to the raw
 * `user_id` while a refresh is in flight, which is also what we want
 * for system / agent senders whose IDs are already human-readable.
 */
import { create } from "zustand";
import { callFunction } from "../lib/api.ts";

export interface UserRow {
  user_id: string;
  display_name: string;
  is_anonymous: boolean;
  role?: string;
}

export interface UsersState {
  byId: Record<string, UserRow>;
  loading: boolean;
  hydrate(workspaceId: string): Promise<void>;
  ensure(workspaceId: string, userId: string): void;
}

let inflight: Promise<void> | null = null;
let lastWorkspaceId: string | null = null;

export const useUsers = create<UsersState>((set, get) => ({
  byId: {},
  loading: false,

  async hydrate(workspaceId: string) {
    if (inflight && lastWorkspaceId === workspaceId) return inflight;
    lastWorkspaceId = workspaceId;
    set({ loading: true });
    inflight = (async () => {
      try {
        const rows = await callFunction<UserRow[]>("users:list", { workspace_id: workspaceId });
        const byId: Record<string, UserRow> = { ...get().byId };
        for (const row of rows) byId[row.user_id] = row;
        set({ byId, loading: false });
      } catch {
        set({ loading: false });
      } finally {
        inflight = null;
      }
    })();
    return inflight;
  },

  ensure(workspaceId: string, userId: string) {
    if (get().byId[userId]) return;
    void get().hydrate(workspaceId);
  },
}));
