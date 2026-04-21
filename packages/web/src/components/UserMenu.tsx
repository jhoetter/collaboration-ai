/**
 * Sidebar user popover.
 *
 * Shows the current user's avatar + display name with a dropdown for
 * editing the display name, setting an emoji status, toggling
 * away/active, and signing out (clears localStorage identity).
 */
import { Avatar, PresenceDot, type PresenceStatus as DotStatus } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { callFunction } from "../lib/api.ts";
import { clearIdentity } from "../lib/identity.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type PresenceStatus } from "../state/sync.ts";

export function UserMenu() {
  const identity = useAuth((s) => s.identity);
  const presence = useSync((s) => s.presence);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(identity?.display_name ?? "");
  const [statusEmoji, setStatusEmoji] = useState("");
  const [statusText, setStatusText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const status = identity ? mapPresence(presence[identity.user_id]) : "offline";

  useEffect(() => {
    setDisplayName(identity?.display_name ?? "");
  }, [identity?.display_name]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function saveName() {
    const next = displayName.trim();
    if (!next || next === identity?.display_name) {
      setEditing(false);
      return;
    }
    await callFunction("users:set-display-name", { display_name: next });
    setEditing(false);
  }

  async function setStatus() {
    await callFunction("users:set-status", {
      emoji: statusEmoji || null,
      status_text: statusText || null,
    });
  }

  async function toggleAway() {
    const target: PresenceStatus = status === "idle" ? "active" : "away";
    await callFunction("users:set-presence", { status: target });
  }

  function signOut() {
    if (!confirm("Sign out and forget this identity?")) return;
    clearIdentity();
    location.reload();
  }

  return (
    <div ref={ref} className="relative mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded bg-slate-800/60 px-2 py-2 text-left hover:bg-slate-800"
      >
        <span className="relative">
          <Avatar name={identity?.display_name ?? "anonymous"} kind="human" size={32} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={status} />
          </span>
        </span>
        <span className="min-w-0">
          <p className="truncate text-xs text-slate-500">You are</p>
          <p className="truncate text-sm font-medium text-collab-teal-300">
            {identity?.display_name ?? "Anonymous"}
          </p>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded border border-slate-700 bg-slate-900 p-3 shadow-2xl">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveName()}
                className="text-xs text-collab-teal-300 hover:underline"
              >
                Save
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full text-left text-sm text-slate-100 hover:text-collab-teal-300"
            >
              Edit display name
            </button>
          )}
          <hr className="my-2 border-slate-800" />
          <p className="text-xs uppercase text-slate-500">Set a status</p>
          <div className="mt-1 flex items-center gap-1">
            <input
              value={statusEmoji}
              onChange={(e) => setStatusEmoji(e.target.value)}
              placeholder="🎯"
              maxLength={4}
              className="w-12 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-center text-sm"
            />
            <input
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder="What's up?"
              className="flex-1 rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            />
            <button
              type="button"
              onClick={() => void setStatus()}
              className="text-xs text-collab-teal-300 hover:underline"
            >
              Save
            </button>
          </div>
          <hr className="my-2 border-slate-800" />
          <button
            type="button"
            onClick={() => void toggleAway()}
            className="block w-full text-left text-sm text-slate-100 hover:text-collab-teal-300"
          >
            {status === "idle" ? "Set as Active" : "Set as Away"}
          </button>
          <button
            type="button"
            onClick={signOut}
            className="mt-1 block w-full text-left text-sm text-rose-300 hover:underline"
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function mapPresence(s: PresenceStatus | undefined): DotStatus {
  switch (s) {
    case "active":
      return "online";
    case "away":
      return "idle";
    case "dnd":
      return "dnd";
    default:
      return "offline";
  }
}
