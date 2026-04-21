import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { useSync } from "../state/sync.ts";

/**
 * Cmd+K palette. Channels are resolved from the local projection so
 * results appear instantly; servers are not consulted on every
 * keystroke.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const channels = useSync((s) => Object.values(s.channels));
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();

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

  if (!open) return null;
  const filtered = channels.filter((c) => c.name.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 pt-24" onClick={() => setOpen(false)}>
      <div
        role="dialog"
        aria-label="Command palette"
        className="w-full max-w-md rounded-lg border border-slate-700 bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Jump to channel, person, command…"
          className="w-full rounded-t-lg bg-slate-900 px-4 py-3 text-sm text-slate-100 outline-none"
        />
        <ul className="max-h-72 overflow-auto border-t border-slate-800">
          {filtered.length === 0 && <li className="px-4 py-3 text-sm text-slate-500">No matches.</li>}
          {filtered.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="block w-full px-4 py-2 text-left text-sm text-slate-100 hover:bg-slate-800"
                onClick={() => {
                  setOpen(false);
                  navigate(`/w/${params.workspaceId}/c/${c.id}`);
                }}
              >
                #{c.name}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
