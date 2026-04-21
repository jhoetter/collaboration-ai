import { useEffect } from "react";
import { useAuth } from "../state/auth.ts";
import { useUsers } from "../state/users.ts";

/**
 * Resolve a `user_id` to its human display name, lazily fetching the
 * workspace's user directory if we haven't seen this id before.
 * Returns the raw `user_id` while the lookup is in flight (and as a
 * permanent fallback for system / agent senders).
 */
export function useDisplayName(userId: string | null | undefined): string {
  const workspaceId = useAuth((s) => s.workspaceId);
  const row = useUsers((s) => (userId ? s.byId[userId] : undefined));
  const ensure = useUsers((s) => s.ensure);

  useEffect(() => {
    if (!userId || !workspaceId) return;
    if (row) return;
    ensure(workspaceId, userId);
  }, [userId, workspaceId, row, ensure]);

  if (!userId) return "";
  return row?.display_name ?? userId;
}
