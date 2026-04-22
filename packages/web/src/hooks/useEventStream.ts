import { useEffect, useRef } from "react";
import { useAuth } from "../state/auth.ts";
import { type Event, useSync } from "../state/sync.ts";
import { useUsers } from "../state/users.ts";

/**
 * Bring the local sync state up to date with the workspace event log.
 *
 * Strategy:
 * 1. Backfill: GET /api/sync once to drain any history past our cursor
 *    (on a fresh tab the cursor is null → we get the full backlog
 *    capped at the server's max_events).
 * 2. Live: open /ws/events. Each frame is a `SyncMessage` envelope:
 *    `{type, workspace_id, cursor, events?, presence?, control?}`. We
 *    only care about events; presence + control frames bump the cursor
 *    so the long-poll fallback resumes from the right place.
 * 3. Fallback: if the socket closes, switch to polling /api/sync every
 *    couple of seconds using the latest cursor token. We never rebuild
 *    state from scratch on reconnect — the server's cursor + our
 *    `highSequence` guard de-dupe re-deliveries.
 */

interface SyncEnvelope {
  type: "event" | "presence" | "typing" | "control";
  workspace_id: string;
  cursor: string;
  events?: Event[];
  presence?: Array<{ user_id: string; status: string; set_at_ms: number }>;
  typing?: Array<{ channel_id: string; user_id: string; expires_at_ms: number }>;
  control?: { kind: string; detail?: Record<string, unknown> };
}

export function useEventStream(workspaceId: string | undefined) {
  const applyMany = useSync((s) => s.applyMany);
  const setCursor = useSync((s) => s.setCursor);
  const applyPresence = useSync((s) => s.applyPresence);
  const applyTyping = useSync((s) => s.applyTyping);
  const pruneTyping = useSync((s) => s.pruneTyping);
  const userId = useAuth((s) => s.identity?.user_id ?? null);
  const socketRef = useRef<WebSocket | null>(null);

  // Expose the live socket via a module ref so the composer can send typing.
  useEffect(() => {
    typingSocket = socketRef;
    return () => {
      if (typingSocket === socketRef) typingSocket = null;
    };
  }, []);

  useEffect(() => {
    if (!workspaceId) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let pollHandle: number | null = null;
    let pingHandle: number | null = null;
    let pruneHandle: number | null = null;

    function handleEnvelope(env: SyncEnvelope) {
      if (env.control?.kind === "force-resync") {
        void backfill();
        return;
      }
      if (env.presence && env.presence.length) {
        applyPresence(
          env.presence.map((p) => ({ user_id: p.user_id, status: p.status as never })),
        );
      }
      if (env.typing && env.typing.length) {
        applyTyping(env.typing);
      }
      if (env.events && env.events.length) {
        applyMany(env.events, env.cursor);
        // Refresh the workspace user directory whenever a new member is
        // added so the "New DM" picker / @-mention popover surface them
        // immediately. Cheap because `users:list` is a single query and
        // only fires for membership-changing events.
        const touchesMembership = env.events.some(
          (e) => e.type === "workspace.member.add" || e.type === "workspace.member.role-set",
        );
        if (touchesMembership && workspaceId) {
          void useUsers.getState().hydrate(workspaceId);
        }
      } else if (env.cursor) {
        setCursor(env.cursor);
      }
    }

    async function backfill() {
      const cursor = useSync.getState().cursor;
      const url = new URL("/api/sync", location.origin);
      url.searchParams.set("workspace_id", workspaceId!);
      if (cursor) url.searchParams.set("since", cursor);
      try {
        const res = await fetch(url.toString());
        if (!res.ok) return;
        const env = (await res.json()) as SyncEnvelope;
        handleEnvelope(env);
      } catch {
        /* offline – the WS / polling loop will retry */
      }
    }

    function startWebSocket() {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const params = new URLSearchParams({ workspace_id: workspaceId! });
      if (userId) params.set("user_id", userId);
      socket = new WebSocket(`${proto}://${location.host}/ws/events?${params.toString()}`);
      socketRef.current = socket;
      socket.onopen = () => {
        // Heartbeat every 25s so the presence TTL doesn't expire on
        // an active tab. Server treats `ping` as a keep-alive.
        pingHandle = window.setInterval(() => {
          try {
            socket?.send(JSON.stringify({ type: "ping" }));
          } catch {
            /* ignore */
          }
        }, 25_000);
      };
      socket.onmessage = (msg) => {
        try {
          const env = JSON.parse(msg.data) as SyncEnvelope;
          handleEnvelope(env);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
        if (pingHandle) {
          clearInterval(pingHandle);
          pingHandle = null;
        }
        if (stopped) return;
        startPolling();
      };
      socket.onerror = () => {
        try {
          socket?.close();
        } catch {
          /* ignore */
        }
      };
    }

    pruneHandle = window.setInterval(() => pruneTyping(Date.now()), 1_000);

    function startPolling() {
      if (pollHandle) return;
      pollHandle = window.setInterval(() => {
        void backfill();
      }, 2_000);
    }

    void backfill().then(() => {
      if (!stopped) startWebSocket();
    });

    return () => {
      stopped = true;
      socket?.close();
      if (pollHandle) {
        clearInterval(pollHandle);
        pollHandle = null;
      }
      if (pingHandle) {
        clearInterval(pingHandle);
        pingHandle = null;
      }
      if (pruneHandle) {
        clearInterval(pruneHandle);
        pruneHandle = null;
      }
    };
  }, [workspaceId, userId, applyMany, applyPresence, applyTyping, pruneTyping, setCursor]);
}

// ---------------------------------------------------------------------------
// Outgoing typing emit — exposed as a module-level helper so the composer
// can send `{type:"typing", channel_id}` frames without prop-drilling the
// socket reference. Returns true when the frame was queued, false when
// no live socket exists (e.g. polling fallback).
// ---------------------------------------------------------------------------

let typingSocket: { current: WebSocket | null } | null = null;

export function sendTypingFrame(channelId: string): boolean {
  const socket = typingSocket?.current;
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify({ type: "typing", channel_id: channelId }));
    return true;
  } catch {
    return false;
  }
}
