/**
 * Tiny TypeScript port of the Python `ProjectedState`. We project the
 * subset of events the UI cares about: channels, recent messages,
 * unread, presence. Server is the source of truth; we just need
 * enough to render optimistically and to apply WebSocket deltas
 * without round-tripping the projector.
 */
import { create } from "zustand";

export type Event = {
  event_id: string;
  type: string;
  content: Record<string, unknown>;
  workspace_id: string;
  room_id: string;
  sender_id: string;
  sender_type: "human" | "agent" | "system";
  origin_ts: number;
  sequence: number;
};

export type Message = {
  id: string;
  channel_id: string;
  thread_root: string | null;
  sender_id: string;
  sender_type: "human" | "agent" | "system";
  content: string;
  mentions: string[];
  sequence: number;
  pending?: boolean;
  redacted?: boolean;
};

export type Channel = {
  id: string;
  name: string;
  type?: string;
  private?: boolean;
};

export type SyncState = {
  cursor: number;
  channels: Record<string, Channel>;
  messagesByChannel: Record<string, Message[]>;
  presence: Record<string, "active" | "away" | "dnd" | "offline">;
  apply(event: Event): void;
  applyOptimistic(message: Message): void;
  reconcileOptimistic(localId: string, real: Message): void;
};

export const useSync = create<SyncState>((set) => ({
  cursor: 0,
  channels: {},
  messagesByChannel: {},
  presence: {},
  apply: (e: Event) =>
    set((s) => {
      const next: Partial<SyncState> = { cursor: Math.max(s.cursor, e.sequence) };
      switch (e.type) {
        case "channel.create": {
          const c = e.content as { name?: string; type?: string; private?: boolean };
          next.channels = { ...s.channels, [e.room_id]: { id: e.room_id, name: c.name ?? e.room_id, type: c.type, private: c.private } };
          break;
        }
        case "message.send": {
          const c = e.content as { content?: string; thread_root?: string | null; mentions?: string[] };
          const msg: Message = {
            id: e.event_id,
            channel_id: e.room_id,
            thread_root: c.thread_root ?? null,
            sender_id: e.sender_id,
            sender_type: e.sender_type,
            content: c.content ?? "",
            mentions: c.mentions ?? [],
            sequence: e.sequence,
          };
          const existing = s.messagesByChannel[e.room_id] ?? [];
          next.messagesByChannel = { ...s.messagesByChannel, [e.room_id]: [...existing, msg] };
          break;
        }
        case "message.redact": {
          const targetId = (e.content as { target_event_id?: string }).target_event_id;
          if (!targetId) break;
          const updated: Record<string, Message[]> = {};
          for (const [chId, msgs] of Object.entries(s.messagesByChannel)) {
            updated[chId] = msgs.map((m) => (m.id === targetId ? { ...m, redacted: true, content: "" } : m));
          }
          next.messagesByChannel = updated;
          break;
        }
        default:
          break;
      }
      return next;
    }),
  applyOptimistic: (message) =>
    set((s) => {
      const existing = s.messagesByChannel[message.channel_id] ?? [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [message.channel_id]: [...existing, { ...message, pending: true }],
        },
      };
    }),
  reconcileOptimistic: (localId, real) =>
    set((s) => {
      const list = s.messagesByChannel[real.channel_id] ?? [];
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [real.channel_id]: list.map((m) => (m.id === localId ? real : m)),
        },
      };
    }),
}));
