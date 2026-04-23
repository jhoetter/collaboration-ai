/**
 * Headless thread-reply pane embed.
 *
 * Re-exports the standalone `<ThreadPane />` (replies to a channel
 * message + composer) wrapped so the host can drop it into a
 * right-rail / drawer of its own. The pane reads its active root
 * message from the in-embed `useThread` Zustand store, which the
 * host can drive via the same store (re-exported below) — typically
 * by responding to a "Reply in thread" event from
 * `CollabAiChannel`.
 *
 * Unlike {@link CollabAiChannel} this surface does not need a
 * router; `ThreadPane` only consumes Zustand stores + React-Query.
 */
import { ThreadPane } from "../../web/src/components/ThreadPane.tsx";

export interface CollabAiThreadPaneProps {
  /** Optional class merged onto the pane's root for layout overrides. */
  className?: string;
}

export function CollabAiThreadPane(_props: CollabAiThreadPaneProps = {}) {
  // Phase A keeps the wrapper trivial; future phases may apply
  // `className` once `ThreadPane` accepts a forwarded class hook.
  return <ThreadPane />;
}

export { useThread } from "../../web/src/state/threads.ts";
