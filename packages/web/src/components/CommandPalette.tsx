/**
 * Cmd+K Spotlight — three tabs: Channels, People, Messages.
 *
 * Channels and People are filtered locally from the projection / user
 * directory for instant feedback. Messages hits `search:messages` on
 * the backend (debounced 200ms) so we get full-text results without
 * shipping the whole event log to the client.
 */
import { Avatar } from "@collabai/ui";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useSync } from "../state/sync.ts";
import { useUsers } from "../state/users.ts";

type Tab = "channels" | "people" | "messages";

interface MessageHit {
  message_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  sequence: number;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("channels");
  const channelMap = useSync((s) => s.channels);
  const usersById = useUsers((s) => s.byId);
  const channels = useMemo(() => Object.values(channelMap), [channelMap]);
  const users = useMemo(() => Object.values(usersById), [usersById]);
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [hits, setHits] = useState<MessageHit[]>([]);
  const debounceRef = useRef<number | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

  useEffect(() => {
    if (tab !== "messages" || !query.trim()) {
      setHits([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void callFunction<MessageHit[]>("search:messages", { query: query.trim(), limit: 20 })
        .then((res) => setHits(res))
        .catch(() => setHits([]));
    }, 200);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, tab]);

  if (!open) return null;

  const filteredChannels = channels
    .filter((c) => c.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 12);
  const filteredUsers = users
    .filter(
      (u) =>
        u.display_name.toLowerCase().includes(query.toLowerCase()) ||
        u.user_id.toLowerCase().includes(query.toLowerCase()),
    )
    .slice(0, 12);

  async function openDmWith(userId: string) {
    setOpen(false);
    try {
      const res = await callFunction<{ events: Array<{ room_id: string }> }>("dm:open", {
        user_ids: [userId],
      });
      const room = res.events[0]?.room_id;
      if (room) navigate(`/w/${params.workspaceId}/c/${room}`);
    } catch (err) {
      console.error(err);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-xl rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to channel, person, message…"
          className="w-full rounded-t-lg bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none"
        />
        <div className="flex border-b border-slate-800">
          {(["channels", "people", "messages"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs uppercase tracking-wide ${
                tab === t
                  ? "border-b-2 border-collab-teal-400 text-slate-100"
                  : "text-slate-500 hover:text-slate-200"
              }`}
            >
              {t}
            </button>
          ))}
        </div>
        <ul className="max-h-80 overflow-auto">
          {tab === "channels" && (
            <>
              {filteredChannels.length === 0 && (
                <li className="px-4 py-3 text-sm text-slate-500">No matches.</li>
              )}
              {filteredChannels.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/w/${params.workspaceId}/c/${c.id}`);
                    }}
                  >
                    <span className="text-slate-500">{c.private ? "🔒" : "#"}</span>
                    <span>{c.name}</span>
                  </button>
                </li>
              ))}
            </>
          )}
          {tab === "people" && (
            <>
              {filteredUsers.length === 0 && (
                <li className="px-4 py-3 text-sm text-slate-500">No matches.</li>
              )}
              {filteredUsers.map((u) => (
                <li key={u.user_id}>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                    onClick={() => void openDmWith(u.user_id)}
                  >
                    <Avatar name={u.display_name} kind="human" size={24} />
                    <span className="flex-1">{u.display_name}</span>
                    <span className="text-xs text-slate-500">{u.user_id}</span>
                  </button>
                </li>
              ))}
            </>
          )}
          {tab === "messages" && (
            <>
              {hits.length === 0 && query.trim() === "" && (
                <li className="px-4 py-3 text-sm text-slate-500">Type to search messages.</li>
              )}
              {hits.length === 0 && query.trim() !== "" && (
                <li className="px-4 py-3 text-sm text-slate-500">No messages found.</li>
              )}
              {hits.map((h) => (
                <li key={h.message_id}>
                  <button
                    type="button"
                    className="block w-full px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                    onClick={() => {
                      setOpen(false);
                      navigate(`/w/${params.workspaceId}/c/${h.channel_id}#${h.message_id}`);
                    }}
                  >
                    <p className="text-xs text-slate-500">
                      <span className="text-collab-teal-300">
                        #{channelMap[h.channel_id]?.name ?? h.channel_id}
                      </span>{" "}
                      · {usersById[h.sender_id]?.display_name ?? h.sender_id}
                    </p>
                    <p className="truncate">{h.content}</p>
                  </button>
                </li>
              ))}
            </>
          )}
        </ul>
      </div>
    </div>
  );
}
