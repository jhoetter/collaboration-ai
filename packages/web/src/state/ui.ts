import { create } from "zustand";

/**
 * Cross-component UI intents that don't belong in any single owner.
 *
 * The command palette wants to "open the new-channel dialog" without
 * owning the dialog itself (the Sidebar does). Rather than hoist the
 * modal state up to `WorkspaceShell` and prop-drill it down two
 * paths, we publish the intent here and let the Sidebar (and any
 * future entry point) react to it.
 */
export interface UiState {
  readonly createChannelOpen: boolean;
  readonly newDmOpen: boolean;
  setCreateChannelOpen(open: boolean): void;
  setNewDmOpen(open: boolean): void;
}

export const useUi = create<UiState>((set) => ({
  createChannelOpen: false,
  newDmOpen: false,
  setCreateChannelOpen(open) {
    set({ createChannelOpen: open });
  },
  setNewDmOpen(open) {
    set({ newDmOpen: open });
  },
}));
