import { useEffect } from "react";
import { type Event, useSync } from "../state/sync.ts";

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
  control?: { kind: string; detail?: Record<string, unknown> };
}

export function useEventStream(workspaceId: string | undefined) {
  const applyMany = useSync((s) => s.applyMany);
  const setCursor = useSync((s) => s.setCursor);

  useEffect(() => {
    if (!workspaceId) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let pollHandle: number | null = null;

    function handleEnvelope(env: SyncEnvelope) {
      if (env.control?.kind === "force-resync") {
        // Server told us we missed events; re-run the backfill from
        // wherever we last committed and let `applyMany` skip already-
        // applied sequences.
        void backfill();
        return;
      }
      if (env.events && env.events.length) {
        applyMany(env.events, env.cursor);
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
      socket = new WebSocket(
        `${proto}://${location.host}/ws/events?workspace_id=${encodeURIComponent(workspaceId!)}`,
      );
      socket.onmessage = (msg) => {
        try {
          const env = JSON.parse(msg.data) as SyncEnvelope;
          handleEnvelope(env);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
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
    };
  }, [workspaceId, applyMany, setCursor]);
}
