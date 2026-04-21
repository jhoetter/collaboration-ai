import { ChannelIcon, Avatar } from "@collabai/ui";
import { Link, useParams } from "react-router";
import { useAuth } from "../state/auth.ts";
import { useSync } from "../state/sync.ts";

export function Sidebar() {
  const params = useParams<{ workspaceId: string; channelId?: string }>();
  const channels = useSync((s) => s.channels);
  const identity = useAuth((s) => s.identity);

  return (
    <aside className="flex w-64 flex-col gap-1 border-r border-slate-800 bg-slate-900 p-2">
      <div className="mb-2 flex items-center gap-2 rounded bg-slate-800/60 px-2 py-2">
        <Avatar
          name={identity?.display_name ?? "anonymous"}
          kind="human"
          size={32}
        />
        <div className="min-w-0">
          <p className="truncate text-xs text-slate-500">You are</p>
          <p className="truncate text-sm font-medium text-collab-teal-300">
            {identity?.display_name ?? "Anonymous"}
          </p>
        </div>
      </div>
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
