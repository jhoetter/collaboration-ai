/**
 * Frontend projection of the server's event log.
 *
 * Mirrors the subset of `ProjectedState` (Python) that the UI needs to
 * render Slack-style chat: channels, messages, reactions, pins,
 * threads, drafts, read markers, presence, typing indicators, mention
 * notifications and active huddles. The server is the source of truth;
 * we project a delta so optimistic sends and incoming WS frames can
 * update the UI without a full re-fetch.
 *
 * Idempotency: `applyMany` skips events whose `sequence` is already
 * past `highSequence`, so re-deliveries (during reconnect / long-poll
 * fallback) are safe. Selectors must always return stable references
 * for unrelated changes — the UI uses `useMemo` over the underlying
 * dictionaries to derive arrays.
 */
import { create } from "zustand";

export type SenderType = "human" | "agent" | "system";

export interface Attachment {
  file_id: string;
  name: string;
  mime: string;
  size_bytes: number;
  width?: number | null;
  height?: number | null;
  thumbnail_url?: string | null;
}

export interface Event {
  event_id: string;
  type: string;
  content: Record<string, unknown>;
  workspace_id: string;
  room_id: string;
  sender_id: string;
  sender_type: SenderType;
  origin_ts: number;
  sequence: number;
  agent_id?: string | null;
  relates_to?: { event_id: string; rel_type: string } | null;
}

export interface Message {
  id: string;
  channel_id: string;
  thread_root: string | null;
  sender_id: string;
  sender_type: SenderType;
  content: string;
  mentions: string[];
  attachments: Attachment[];
  sequence: number;
  origin_ts: number;
  edited_at?: number | null;
  redacted?: boolean;
  thread_reply_count?: number;
  thread_last_reply_ts?: number | null;
  pending?: boolean;
}

export interface Channel {
  id: string;
  name: string;
  type?: string;
  private?: boolean;
  topic?: string | null;
  description?: string | null;
  archived?: boolean;
}

export type PresenceStatus = "active" | "away" | "dnd" | "offline";

export interface NotificationRow {
  id: string;
  workspace_id: string;
  channel_id: string | null;
  kind: string;
  target_event_id: string | null;
  body: string | null;
  created_at: number;
  read: boolean;
}

export interface HuddleRoom {
  huddle_id: string;
  channel_id: string;
  livekit_room: string;
  started_by: string;
  started_at: number;
  ended_at: number | null;
  participants: string[];
  title?: string | null;
}

export interface ReactionMap {
  // emoji -> set of user_ids who reacted
  [emoji: string]: string[];
}

export interface SyncState {
  cursor: string | null;
  highSequence: number;
  channels: Record<string, Channel>;
  messagesByChannel: Record<string, Message[]>;
  messageById: Record<string, Message>;
  reactionsByMessage: Record<string, ReactionMap>;
  pinsByChannel: Record<string, string[]>;
  draftsByChannel: Record<string, { content: string; thread_root: string | null }>;
  readUpToByChannel: Record<string, number>;
  notifications: Record<string, NotificationRow>;
  presence: Record<string, PresenceStatus>;
  typingByChannel: Record<string, Record<string, number>>;
  huddlesByChannel: Record<string, HuddleRoom>;
  // Mutators
  apply(event: Event): void;
  applyMany(events: Event[], cursor?: string | null): void;
  setCursor(cursor: string | null): void;
  applyOptimistic(message: Message): void;
  reconcileOptimistic(localId: string, real: Message): void;
  upsertChannel(channel: Channel): void;
  setReadUpTo(channelId: string, sequence: number): void;
  applyPresence(updates: Array<{ user_id: string; status: PresenceStatus }>): void;
  applyTyping(updates: Array<{ channel_id: string; user_id: string; expires_at_ms: number }>): void;
  pruneTyping(now: number): void;
  setNotificationRead(notificationId: string): void;
  setDraft(channelId: string, content: string, threadRoot?: string | null): void;
}

const _empty: never[] = [];

function _ensureChannel(map: Record<string, Channel>, id: string, init?: Partial<Channel>): Record<string, Channel> {
  if (map[id]) return map;
  return { ...map, [id]: { id, name: init?.name ?? id, ...init } };
}

function _appendMessage(
  byChannel: Record<string, Message[]>,
  byId: Record<string, Message>,
  msg: Message,
): { byChannel: Record<string, Message[]>; byId: Record<string, Message> } {
  if (byId[msg.id]) {
    // Already projected — normalise in case of re-delivery with extra fields.
    const merged = { ...byId[msg.id], ...msg };
    const list = byChannel[msg.channel_id] ?? [];
    return {
      byChannel: { ...byChannel, [msg.channel_id]: list.map((m) => (m.id === msg.id ? merged : m)) },
      byId: { ...byId, [msg.id]: merged },
    };
  }
  const existing = byChannel[msg.channel_id] ?? [];
  // Reconcile any pending optimistic copy from this sender.
  const filtered = existing.filter(
    (m) => !(m.pending && m.sender_id === msg.sender_id && m.content === msg.content),
  );
  return {
    byChannel: { ...byChannel, [msg.channel_id]: [...filtered, msg] },
    byId: { ...byId, [msg.id]: msg },
  };
}

function _bumpThreadCount(
  byId: Record<string, Message>,
  byChannel: Record<string, Message[]>,
  rootId: string,
  ts: number,
): { byId: Record<string, Message>; byChannel: Record<string, Message[]> } {
  const root = byId[rootId];
  if (!root) return { byId, byChannel };
  const updated: Message = {
    ...root,
    thread_reply_count: (root.thread_reply_count ?? 0) + 1,
    thread_last_reply_ts: ts,
  };
  const list = byChannel[root.channel_id] ?? [];
  return {
    byId: { ...byId, [rootId]: updated },
    byChannel: { ...byChannel, [root.channel_id]: list.map((m) => (m.id === rootId ? updated : m)) },
  };
}

export const useSync = create<SyncState>((set, get) => ({
  cursor: null,
  highSequence: 0,
  channels: {},
  messagesByChannel: {},
  messageById: {},
  reactionsByMessage: {},
  pinsByChannel: {},
  draftsByChannel: {},
  readUpToByChannel: {},
  notifications: {},
  presence: {},
  typingByChannel: {},
  huddlesByChannel: {},

  apply(event) {
    get().applyMany([event]);
  },

  applyMany(events, cursor) {
    set((s) => {
      let highSequence = s.highSequence;
      let channels = s.channels;
      let messagesByChannel = s.messagesByChannel;
      let messageById = s.messageById;
      let reactionsByMessage = s.reactionsByMessage;
      let pinsByChannel = s.pinsByChannel;
      let draftsByChannel = s.draftsByChannel;
      let huddlesByChannel = s.huddlesByChannel;
      let notifications = s.notifications;
      let mutated = false;

      for (const e of events) {
        if (e.sequence <= highSequence) continue;
        highSequence = Math.max(highSequence, e.sequence);
        mutated = true;

        switch (e.type) {
          case "channel.create": {
            const c = e.content as { name?: string; type?: string; private?: boolean; topic?: string; description?: string };
            channels = {
              ...channels,
              [e.room_id]: {
                id: e.room_id,
                name: c.name ?? e.room_id,
                type: c.type,
                private: c.private,
                topic: c.topic ?? null,
                description: c.description ?? null,
                archived: false,
              },
            };
            break;
          }
          case "channel.update": {
            const ch = channels[e.room_id];
            if (!ch) break;
            channels = {
              ...channels,
              [e.room_id]: {
                ...ch,
                ...(typeof e.content.name === "string" ? { name: e.content.name as string } : {}),
                ...(typeof e.content.topic === "string" ? { topic: e.content.topic as string } : {}),
                ...(typeof e.content.description === "string"
                  ? { description: e.content.description as string }
                  : {}),
              },
            };
            break;
          }
          case "channel.archive":
          case "channel.unarchive": {
            const ch = channels[e.room_id];
            if (!ch) break;
            channels = { ...channels, [e.room_id]: { ...ch, archived: e.type === "channel.archive" } };
            break;
          }
          case "channel.topic.set": {
            const ch = channels[e.room_id];
            if (!ch) break;
            channels = { ...channels, [e.room_id]: { ...ch, topic: (e.content.topic ?? null) as string | null } };
            break;
          }
          case "message.send": {
            const c = e.content as {
              content?: string;
              thread_root?: string | null;
              mentions?: string[];
              attachments?: Attachment[];
            };
            const msg: Message = {
              id: e.event_id,
              channel_id: e.room_id,
              thread_root: c.thread_root ?? null,
              sender_id: e.sender_id,
              sender_type: e.sender_type,
              content: c.content ?? "",
              mentions: c.mentions ?? [],
              attachments: c.attachments ?? [],
              sequence: e.sequence,
              origin_ts: e.origin_ts,
            };
            const next = _appendMessage(messagesByChannel, messageById, msg);
            messagesByChannel = next.byChannel;
            messageById = next.byId;
            if (msg.thread_root) {
              const bumped = _bumpThreadCount(messageById, messagesByChannel, msg.thread_root, e.origin_ts);
              messageById = bumped.byId;
              messagesByChannel = bumped.byChannel;
            }
            break;
          }
          case "message.edit": {
            const targetId = e.relates_to?.event_id;
            if (!targetId) break;
            const msg = messageById[targetId];
            if (!msg) break;
            const updated: Message = {
              ...msg,
              content: (e.content.new_content as string) ?? (e.content.content as string) ?? msg.content,
              mentions: Array.isArray(e.content.mentions) ? (e.content.mentions as string[]) : msg.mentions,
              edited_at: e.origin_ts,
            };
            const list = messagesByChannel[msg.channel_id] ?? [];
            messagesByChannel = {
              ...messagesByChannel,
              [msg.channel_id]: list.map((m) => (m.id === targetId ? updated : m)),
            };
            messageById = { ...messageById, [targetId]: updated };
            break;
          }
          case "message.redact": {
            const targetId = e.relates_to?.event_id ?? (e.content.target_event_id as string | undefined);
            if (!targetId) break;
            const msg = messageById[targetId];
            if (!msg) break;
            const updated: Message = { ...msg, redacted: true, content: "", attachments: [] };
            const list = messagesByChannel[msg.channel_id] ?? [];
            messagesByChannel = {
              ...messagesByChannel,
              [msg.channel_id]: list.map((m) => (m.id === targetId ? updated : m)),
            };
            messageById = { ...messageById, [targetId]: updated };
            const remainingReactions = { ...reactionsByMessage };
            delete remainingReactions[targetId];
            reactionsByMessage = remainingReactions;
            break;
          }
          case "reaction.add": {
            const targetId = e.relates_to?.event_id;
            if (!targetId) break;
            const emoji = e.content.emoji as string;
            const map = { ...(reactionsByMessage[targetId] ?? {}) };
            const users = new Set(map[emoji] ?? []);
            users.add(e.sender_id);
            map[emoji] = Array.from(users);
            reactionsByMessage = { ...reactionsByMessage, [targetId]: map };
            break;
          }
          case "reaction.remove": {
            const targetId = e.relates_to?.event_id;
            if (!targetId) break;
            const emoji = e.content.emoji as string;
            const map = { ...(reactionsByMessage[targetId] ?? {}) };
            const users = (map[emoji] ?? []).filter((u) => u !== e.sender_id);
            if (users.length) map[emoji] = users;
            else delete map[emoji];
            reactionsByMessage = { ...reactionsByMessage, [targetId]: map };
            break;
          }
          case "channel.pin.add": {
            const mid = e.content.message_id as string;
            const list = pinsByChannel[e.room_id] ?? [];
            if (!list.includes(mid)) {
              pinsByChannel = { ...pinsByChannel, [e.room_id]: [mid, ...list] };
            }
            break;
          }
          case "channel.pin.remove": {
            const mid = e.content.message_id as string;
            const list = (pinsByChannel[e.room_id] ?? []).filter((x) => x !== mid);
            pinsByChannel = { ...pinsByChannel, [e.room_id]: list };
            break;
          }
          case "draft.set": {
            draftsByChannel = {
              ...draftsByChannel,
              [e.room_id]: {
                content: (e.content.content as string) ?? "",
                thread_root: (e.content.thread_root as string | null | undefined) ?? null,
              },
            };
            break;
          }
          case "draft.clear": {
            const next = { ...draftsByChannel };
            delete next[e.room_id];
            draftsByChannel = next;
            break;
          }
          case "read.marker": {
            const seq = (e.content.up_to_sequence as number | undefined) ?? e.sequence;
            const current = s.readUpToByChannel[e.room_id] ?? 0;
            if (seq > current) {
              s.readUpToByChannel = { ...s.readUpToByChannel, [e.room_id]: seq };
            }
            break;
          }
          case "notification.create": {
            const nid = e.content.notification_id as string;
            notifications = {
              ...notifications,
              [nid]: {
                id: nid,
                workspace_id: e.workspace_id,
                channel_id: e.room_id || null,
                kind: (e.content.kind as string) ?? "mention",
                target_event_id: (e.content.target_event_id as string | null) ?? null,
                body: (e.content.body as string | null) ?? null,
                created_at: e.origin_ts,
                read: false,
              },
            };
            break;
          }
          case "notification.read": {
            const nid = e.content.notification_id as string;
            const existing = notifications[nid];
            if (existing) notifications = { ...notifications, [nid]: { ...existing, read: true } };
            break;
          }
          case "huddle.start": {
            const hid = e.content.huddle_id as string;
            huddlesByChannel = {
              ...huddlesByChannel,
              [e.room_id]: {
                huddle_id: hid,
                channel_id: e.room_id,
                livekit_room: (e.content.livekit_room as string) ?? hid,
                started_by: e.sender_id,
                started_at: e.origin_ts,
                ended_at: null,
                participants: [e.sender_id],
                title: (e.content.title as string | null) ?? null,
              },
            };
            break;
          }
          case "huddle.join": {
            const room = huddlesByChannel[e.room_id];
            if (!room) break;
            if (!room.participants.includes(e.sender_id)) {
              huddlesByChannel = {
                ...huddlesByChannel,
                [e.room_id]: { ...room, participants: [...room.participants, e.sender_id] },
              };
            }
            break;
          }
          case "huddle.leave": {
            const room = huddlesByChannel[e.room_id];
            if (!room) break;
            huddlesByChannel = {
              ...huddlesByChannel,
              [e.room_id]: { ...room, participants: room.participants.filter((u) => u !== e.sender_id) },
            };
            break;
          }
          case "huddle.end": {
            const room = huddlesByChannel[e.room_id];
            if (!room) break;
            const next = { ...huddlesByChannel };
            delete next[e.room_id];
            huddlesByChannel = next;
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
        next.messageById = messageById;
        next.reactionsByMessage = reactionsByMessage;
        next.pinsByChannel = pinsByChannel;
        next.draftsByChannel = draftsByChannel;
        next.huddlesByChannel = huddlesByChannel;
        next.notifications = notifications;
        next.readUpToByChannel = s.readUpToByChannel;
      }
      if (cursor !== undefined) next.cursor = cursor;
      return next;
    });
  },

  setCursor(cursor) {
    set({ cursor });
  },

  applyOptimistic(message) {
    set((s) => {
      const existing = s.messagesByChannel[message.channel_id] ?? _empty;
      return {
        messagesByChannel: {
          ...s.messagesByChannel,
          [message.channel_id]: [...existing, { ...message, pending: true }],
        },
      };
    });
  },

  reconcileOptimistic(localId, real) {
    set((s) => {
      const list = s.messagesByChannel[real.channel_id] ?? _empty;
      const updated = list.map((m) => (m.id === localId ? real : m));
      return {
        messagesByChannel: { ...s.messagesByChannel, [real.channel_id]: updated },
        messageById: { ...s.messageById, [real.id]: real },
      };
    });
  },

  upsertChannel(channel) {
    set((s) => ({ channels: _ensureChannel(s.channels, channel.id, channel) }));
  },

  setReadUpTo(channelId, sequence) {
    set((s) => {
      const current = s.readUpToByChannel[channelId] ?? 0;
      if (sequence <= current) return s;
      return { readUpToByChannel: { ...s.readUpToByChannel, [channelId]: sequence } };
    });
  },

  applyPresence(updates) {
    set((s) => {
      const next = { ...s.presence };
      for (const u of updates) next[u.user_id] = u.status;
      return { presence: next };
    });
  },

  applyTyping(updates) {
    set((s) => {
      const next = { ...s.typingByChannel };
      for (const u of updates) {
        const bucket = { ...(next[u.channel_id] ?? {}) };
        bucket[u.user_id] = u.expires_at_ms;
        next[u.channel_id] = bucket;
      }
      return { typingByChannel: next };
    });
  },

  pruneTyping(now) {
    set((s) => {
      const next: Record<string, Record<string, number>> = {};
      let mutated = false;
      for (const [channelId, bucket] of Object.entries(s.typingByChannel)) {
        const filtered: Record<string, number> = {};
        for (const [userId, expiresAt] of Object.entries(bucket)) {
          if (expiresAt > now) filtered[userId] = expiresAt;
          else mutated = true;
        }
        if (Object.keys(filtered).length) next[channelId] = filtered;
        else mutated = true;
      }
      return mutated ? { typingByChannel: next } : s;
    });
  },

  setNotificationRead(notificationId) {
    set((s) => {
      const n = s.notifications[notificationId];
      if (!n) return s;
      return { notifications: { ...s.notifications, [notificationId]: { ...n, read: true } } };
    });
  },

  setDraft(channelId, content, threadRoot) {
    set((s) => {
      if (!content) {
        const next = { ...s.draftsByChannel };
        delete next[channelId];
        return { draftsByChannel: next };
      }
      return {
        draftsByChannel: {
          ...s.draftsByChannel,
          [channelId]: { content, thread_root: threadRoot ?? null },
        },
      };
    });
  },
}));
