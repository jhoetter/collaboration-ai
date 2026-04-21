/**
 * Drop into packages/hof-components/data-app/ui/components/ in hof-os.
 *
 * Lazy-imports @collabai/react-embeds so the data-app keeps building
 * even when ensure-collabai-react-embeds.cjs soft-fails (e.g. during
 * an air-gapped install where the lockfile points at an unreachable
 * tarball). Mirrors the pattern used by CreateNewAssetMenu.tsx for
 * office-ai.
 */
import { lazy, Suspense } from "react";

type ChatPanelProps = {
  workspaceId: string;
  authToken: string;
};

const ChatPanel = lazy(async () => {
  try {
    const mod = await import("@collabai/react-embeds");
    return { default: mod.ChatPanel };
  } catch {
    return { default: () => null };
  }
});

export function ChatSidebar(props: ChatPanelProps) {
  return (
    <Suspense fallback={null}>
      <ChatPanel {...props} />
    </Suspense>
  );
}
