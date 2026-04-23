export type {
  AgentInboxProps,
  ChannelViewProps,
  ChatPanelProps,
  CollabAiCommandContext,
  CommandPaletteItem,
  EmbedCommonProps,
  EmbedConnection,
  EmbedIdentity,
} from "./contract";

export { ChatPanel } from "./ChatPanel";
export { ChannelView } from "./ChannelView";
export { AgentInbox } from "./AgentInbox";
export { AttachmentViewer, attachmentKindFor } from "./components/AttachmentViewer";
export type { AttachmentKind, AttachmentViewerProps } from "./components/AttachmentViewer";

// Legacy "all-or-nothing" embed: hosts mount the full WorkspaceShell
// + sidebar + channels + DMs via a single component. Kept exported
// for backward compatibility (standalone web app + existing v0.2.x
// hof-os integration), but new hosts should compose the headless
// pieces below instead.
export { CollabAiApp } from "./CollabAiApp";
export type { CollabAiAppProps, CollabAiHostHooks } from "./CollabAiApp";
export type { WorkspaceShellChrome } from "../../web/src/pages/WorkspaceShell";

// Provider — standalone canonical name is `AppProviders`; we expose
// `CollabAiProvider` as the public alias and keep `AppProviders`
// exported for BC.
export { AppProviders } from "./AppProviders";
export { AppProviders as CollabAiProvider } from "./AppProviders";
export type { AppProvidersProps } from "./AppProviders";
export type { AppProvidersProps as CollabAiProviderProps } from "./AppProviders";

// Headless composable embeds (v0.3.0+). The hof-os data-app composes
// these inside its own chrome; standalone keeps using `CollabAiApp`.
export { CollabAiChannelList } from "./CollabAiChannelList";
export type { CollabAiChannelListProps } from "./CollabAiChannelList";
export { CollabAiChannel } from "./CollabAiChannel";
export type { CollabAiChannelProps } from "./CollabAiChannel";
export { CollabAiThreadPane, useThread } from "./CollabAiThreadPane";
export type { CollabAiThreadPaneProps } from "./CollabAiThreadPane";
export { CollabAiActivityPane } from "./CollabAiActivityPane";
export type { CollabAiActivityPaneProps } from "./CollabAiActivityPane";
export { CollabAiSearchInput } from "./CollabAiSearchInput";
export type { CollabAiSearchInputProps } from "./CollabAiSearchInput";
export { collabaiCommands } from "./commands";
