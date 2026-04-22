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

const SECTION_STATE_KEY = "collab.sidebar.sections.v1";

type SectionId =
  | "channels"
  | "dms"
  | "saved"
  | "mentions"
  | "drafts"
  | "activity";

function loadSectionState(): Record<SectionId, boolean> {
  if (typeof window === "undefined")
    return {
      channels: true,
      dms: true,
      saved: true,
      mentions: true,
      drafts: true,
      activity: true,
    };
  try {
    const raw = window.localStorage.getItem(SECTION_STATE_KEY);
    if (!raw)
      return {
        channels: true,
        dms: true,
        saved: true,
        mentions: true,
        drafts: true,
        activity: true,
      };
    const parsed = JSON.parse(raw) as Partial<Record<SectionId, boolean>>;
    return {
      channels: parsed.channels ?? true,
      dms: parsed.dms ?? true,
      saved: parsed.saved ?? true,
      mentions: parsed.mentions ?? true,
      drafts: parsed.drafts ?? true,
      activity: parsed.activity ?? true,
    };
  } catch {
    return {
      channels: true,
      dms: true,
      saved: true,
      mentions: true,
      drafts: true,
      activity: true,
    };
  }
}

function persistSectionState(state: Record<SectionId, boolean>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(state));
  } catch {
    /* ignore quota / private mode errors */
  }
}

export type SidebarPanelId = "activity" | "later" | "files";

export interface UiState {
  readonly createChannelOpen: boolean;
  readonly newDmOpen: boolean;
  readonly membersPanelOpen: boolean;
  /**
   * Mobile/tablet only: drives the sidebar slide-in drawer. At ≥lg the
   * sidebar is always rendered via CSS so this flag is a no-op there.
   */
  readonly sidebarOpen: boolean;
  readonly sectionsOpen: Record<SectionId, boolean>;
  /**
   * Which floating sidebar panel (Activity / Later / Files) is open, or
   * `null` when none. Mirrors Slack's icon-rail popovers — the panel
   * floats over the channel area and can be dismissed via outside
   * click, Escape, or by toggling its trigger again.
   */
  readonly openSidebarPanel: SidebarPanelId | null;
  /**
   * Optional pre-fill for the workspace top search bar. Components publish
   * a query (e.g. the channel header's "search in channel" button) and the
   * `TopBar` consumes it on its next render. Cleared by the bar after read.
   */
  readonly searchQuery: string | null;
  setCreateChannelOpen(open: boolean): void;
  setNewDmOpen(open: boolean): void;
  setMembersPanelOpen(open: boolean): void;
  setSidebarOpen(open: boolean): void;
  toggleSidebar(): void;
  setSearchQuery(query: string | null): void;
  toggleSection(id: SectionId): void;
  setOpenSidebarPanel(panel: SidebarPanelId | null): void;
  toggleSidebarPanel(panel: SidebarPanelId): void;
}

export const useUi = create<UiState>((set, get) => ({
  createChannelOpen: false,
  newDmOpen: false,
  membersPanelOpen: false,
  sidebarOpen: false,
  searchQuery: null,
  openSidebarPanel: null,
  sectionsOpen: loadSectionState(),
  setCreateChannelOpen(open) {
    set({ createChannelOpen: open });
  },
  setNewDmOpen(open) {
    set({ newDmOpen: open });
  },
  setMembersPanelOpen(open) {
    set({ membersPanelOpen: open });
  },
  setSidebarOpen(open) {
    set({ sidebarOpen: open });
  },
  toggleSidebar() {
    set({ sidebarOpen: !get().sidebarOpen });
  },
  setSearchQuery(query) {
    set({ searchQuery: query });
  },
  toggleSection(id) {
    const next = { ...get().sectionsOpen, [id]: !get().sectionsOpen[id] };
    persistSectionState(next);
    set({ sectionsOpen: next });
  },
  setOpenSidebarPanel(panel) {
    set({ openSidebarPanel: panel });
  },
  toggleSidebarPanel(panel) {
    set({ openSidebarPanel: get().openSidebarPanel === panel ? null : panel });
  },
}));

export type { SectionId };
