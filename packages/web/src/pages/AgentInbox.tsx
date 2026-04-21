import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@collabai/ui";
import { useParams } from "react-router";
import { callFunction } from "../lib/api.ts";

type Proposal = {
  id: string;
  agent_id: string;
  command_type: string;
  payload: Record<string, unknown>;
  created_ts: number;
  status: "pending" | "approved" | "rejected";
};

export function AgentInbox() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["agent-inbox", workspaceId],
    queryFn: () => callFunction<{ proposals: Proposal[] }>("agent:list-staged", { workspace_id: workspaceId }),
    refetchInterval: 5_000,
    enabled: !!workspaceId,
  });

  async function approve(id: string) {
    await callFunction("agent:approve", { workspace_id: workspaceId, proposal_id: id });
    qc.invalidateQueries({ queryKey: ["agent-inbox", workspaceId] });
  }

  async function reject(id: string) {
    await callFunction("agent:reject", { workspace_id: workspaceId, proposal_id: id });
    qc.invalidateQueries({ queryKey: ["agent-inbox", workspaceId] });
  }

  return (
    <aside className="w-80 border-l border-slate-800 bg-slate-900 p-3">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Agent inbox</h2>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {data?.proposals.length === 0 && <p className="text-sm text-slate-500">No pending proposals.</p>}
      <ul className="flex flex-col gap-3">
        {data?.proposals.map((p) => (
          <li key={p.id} className="rounded border border-slate-800 bg-slate-950 p-2">
            <p className="text-xs text-collab-teal-300">{p.agent_id}</p>
            <p className="text-sm text-slate-100">{p.command_type}</p>
            <pre className="mt-1 overflow-x-auto text-[11px] text-slate-400">
              {JSON.stringify(p.payload, null, 2)}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => approve(p.id)}>
                Approve
              </Button>
              <Button variant="danger" size="sm" onClick={() => reject(p.id)}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
