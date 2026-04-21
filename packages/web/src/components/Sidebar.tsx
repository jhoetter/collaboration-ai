import { ChannelIcon } from "@collabai/ui";
import { Link, useParams } from "react-router";
import { useSync } from "../state/sync.ts";

export function Sidebar() {
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  const channels = useSync((s) => s.channels);

  return (
    <aside className="flex w-64 flex-col gap-1 border-r border-slate-800 bg-slate-900 p-2">
      <h2 className="px-2 py-1 text-xs uppercase tracking-wide text-slate-500">Channels</h2>
      {Object.values(channels).length === 0 && (
        <p className="px-2 text-sm text-slate-500">No channels yet.</p>
      )}
      {Object.values(channels).map((c) => (
        <Link
          key={c.id}
          to={`/w/${params.workspaceId}/c/${c.id}`}
          className={`flex items-center gap-2 rounded px-2 py-1 text-sm ${
            params.channelId === c.id ? "bg-slate-800 text-collab-teal-300" : "text-slate-300 hover:bg-slate-800"
          }`}
        >
          <ChannelIcon kind={c.private ? "private" : "public"} />
          <span className="truncate">{c.name}</span>
        </Link>
      ))}
    </aside>
  );
}
