/**
 * "X is typing…" pill above the composer.
 *
 * Reads `typingByChannel` from the sync store; the WS gateway sends a
 * `typing` frame whenever someone sends `{type:typing, channel_id}` and
 * we filter out stale entries (older than the server's TTL) on the
 * client via the `pruneTyping` ticker.
 */
import { useMemo } from "react";
import { useDisplayName } from "../hooks/useDisplayName.ts";
import { useAuth } from "../state/auth.ts";
import { useSync } from "../state/sync.ts";

export function TypingIndicator({ channelId }: { channelId: string }) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const bucket = useSync((s) => s.typingByChannel[channelId]);

  const userIds = useMemo(() => {
    if (!bucket) return [] as string[];
    const now = Date.now();
    return Object.entries(bucket)
      .filter(([userId, expires]) => userId !== me && expires > now)
      .map(([userId]) => userId);
  }, [bucket, me]);

  if (userIds.length === 0) {
    return <div className="h-5" aria-hidden="true" />;
  }
  return (
    <div className="px-4 py-1 text-xs italic text-tertiary">
      <TypingNames userIds={userIds} />
    </div>
  );
}

function TypingNames({ userIds }: { userIds: string[] }) {
  if (userIds.length === 1) return <Single userId={userIds[0]} suffix=" is typing…" />;
  if (userIds.length === 2)
    return (
      <>
        <Single userId={userIds[0]} /> and <Single userId={userIds[1]} suffix=" are typing…" />
      </>
    );
  return <span>Several people are typing…</span>;
}

function Single({ userId, suffix }: { userId: string; suffix?: string }) {
  const name = useDisplayName(userId);
  return (
    <span>
      {name || userId}
      {suffix}
    </span>
  );
}
