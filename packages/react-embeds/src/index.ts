export type {
  AgentInboxProps,
  ChannelViewProps,
  ChatPanelProps,
  EmbedCommonProps,
  EmbedConnection,
  EmbedIdentity,
} from "./contract";

export { ChatPanel } from "./ChatPanel";
export { ChannelView } from "./ChannelView";
export { AgentInbox } from "./AgentInbox";
export { AttachmentViewer, attachmentKindFor } from "./components/AttachmentViewer";
export type { AttachmentKind, AttachmentViewerProps } from "./components/AttachmentViewer";

// New canonical embed: hosts mount the full WorkspaceShell + sidebar
// + channels + DMs via a single component, identity / API base / JWT
// flow in through `hooks`. The legacy ChatPanel/ChannelView/AgentInbox
// exports are kept for backward compatibility but are no longer the
// recommended integration path.
export { CollabAiApp } from "./CollabAiApp";
export type { CollabAiAppProps, CollabAiHostHooks } from "./CollabAiApp";
export type { WorkspaceShellChrome } from "../../web/src/pages/WorkspaceShell";
export { AppProviders } from "./AppProviders";
export type { AppProvidersProps } from "./AppProviders";
