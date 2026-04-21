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
  cursor: string | null;
  highSequence: number;
  channels: Record<string, Channel>;
  messagesByChannel: Record<string, Message[]>;
  presence: Record<string, "active" | "away" | "dnd" | "offline">;
  apply(event: Event): void;
  applyMany(events: Event[], cursor?: string | null): void;
  setCursor(cursor: string | null): void;
  applyOptimistic(message: Message): void;
  reconcileOptimistic(localId: string, real: Message): void;
};

export const useSync = create<SyncState>((set) => ({
  cursor: null,
  highSequence: 0,
  channels: {},
  messagesByChannel: {},
  presence: {},
  apply: (e: Event) =>
    set((s) => {
      // Skip events we've already projected (re-delivery during resubscribe).
      if (e.sequence <= s.highSequence) return s;
      const next: Partial<SyncState> = { highSequence: Math.max(s.highSequence, e.sequence) };
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
  applyMany: (events, cursor) =>
    set((s) => {
      let highSequence = s.highSequence;
      let channels = s.channels;
      let messagesByChannel = s.messagesByChannel;
      let mutated = false;
      for (const e of events) {
        if (e.sequence <= highSequence) continue;
        highSequence = Math.max(highSequence, e.sequence);
        switch (e.type) {
          case "channel.create": {
            const c = e.content as { name?: string; type?: string; private?: boolean };
            channels = {
              ...channels,
              [e.room_id]: {
                id: e.room_id,
                name: c.name ?? e.room_id,
                type: c.type,
                private: c.private,
              },
            };
            mutated = true;
            break;
          }
          case "message.send": {
            const c = e.content as {
              content?: string;
              thread_root?: string | null;
              mentions?: string[];
            };
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
            const existing = messagesByChannel[e.room_id] ?? [];
            // Reconcile any pending optimistic copy authored by us.
            const filtered = existing.filter(
              (m) => !(m.pending && m.sender_id === e.sender_id && m.content === msg.content),
            );
            // Avoid double-inserting if this exact event already landed.
            if (!filtered.some((m) => m.id === msg.id)) {
              messagesByChannel = {
                ...messagesByChannel,
                [e.room_id]: [...filtered, msg],
              };
            } else if (filtered.length !== existing.length) {
              messagesByChannel = { ...messagesByChannel, [e.room_id]: filtered };
            }
            mutated = true;
            break;
          }
          case "message.redact": {
            const targetId = (e.content as { target_event_id?: string }).target_event_id;
            if (!targetId) break;
            const updated: Record<string, Message[]> = {};
            for (const [chId, msgs] of Object.entries(messagesByChannel)) {
              updated[chId] = msgs.map((m) =>
                m.id === targetId ? { ...m, redacted: true, content: "" } : m,
              );
            }
            messagesByChannel = updated;
            mutated = true;
            break;
          }
          default:
            break;
        }
      }
      const next: Partial<SyncState> = { highSequence };
      if (mutated) {
        next.channels = channels;
        next.messagesByChannel = messagesByChannel;
      }
      if (cursor !== undefined) next.cursor = cursor;
      return next;
    }),
  setCursor: (cursor) => set({ cursor }),
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
