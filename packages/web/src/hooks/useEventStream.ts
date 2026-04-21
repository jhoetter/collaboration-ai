import { useEffect } from "react";
import { useSync } from "../state/sync.ts";

/**
 * Subscribe to /ws/events for the current workspace. Reconnect on
 * close. Falls back to polling /api/sync if the socket fails twice.
 */
export function useEventStream(workspaceId: string | undefined) {
  const apply = useSync((s) => s.apply);
  const cursor = useSync((s) => s.cursor);

  useEffect(() => {
    if (!workspaceId) return;
    let socket: WebSocket | null = null;
    let stopped = false;
    let pollHandle: number | null = null;

    function startWebSocket() {
      socket = new WebSocket(`ws://${location.host}/ws/events?workspace_id=${workspaceId}`);
      socket.onmessage = (msg) => {
        try {
          const event = JSON.parse(msg.data);
          apply(event);
        } catch {
          /* ignore */
        }
      };
      socket.onclose = () => {
        if (!stopped) startPolling();
      };
    }

    function startPolling() {
      pollHandle = window.setInterval(async () => {
        const res = await fetch(`/api/sync?workspace_id=${workspaceId}&since=${cursor}`);
        if (!res.ok) return;
        const body = (await res.json()) as { events: unknown[] };
        for (const evt of body.events) {
          apply(evt as Parameters<typeof apply>[0]);
        }
      }, 2_000);
    }

    startWebSocket();

    return () => {
      stopped = true;
      socket?.close();
      if (pollHandle) clearInterval(pollHandle);
    };
  }, [workspaceId, apply, cursor]);
}
