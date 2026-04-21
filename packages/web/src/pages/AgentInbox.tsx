import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@collabai/ui";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";

interface ProposalRow {
  proposal_id: string;
  agent_id: string | null;
  channel_id: string;
  command_type: string;
  payload: Record<string, unknown>;
  rationale: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: number;
}

export function AgentInbox() {
  const workspaceId = useAuth((s) => s.workspaceId);
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["agent-inbox", workspaceId],
    queryFn: () => callFunction<ProposalRow[]>("agent:list-proposals", { status: "pending" }),
    refetchInterval: 5_000,
    enabled: !!workspaceId,
  });

  const proposals = data ?? [];

  async function approve(proposalId: string) {
    await callFunction("agent:approve-proposal", { proposal_id: proposalId });
    qc.invalidateQueries({ queryKey: ["agent-inbox", workspaceId] });
  }

  async function reject(proposalId: string) {
    await callFunction("agent:reject-proposal", { proposal_id: proposalId });
    qc.invalidateQueries({ queryKey: ["agent-inbox", workspaceId] });
  }

  return (
    <aside className="w-80 border-l border-slate-800 bg-slate-900 p-3">
      <h2 className="mb-2 text-xs uppercase tracking-wide text-slate-500">Agent inbox</h2>
      {isLoading && <p className="text-sm text-slate-500">Loading…</p>}
      {!isLoading && proposals.length === 0 && (
        <p className="text-sm text-slate-500">No pending proposals.</p>
      )}
      <ul className="flex flex-col gap-3">
        {proposals.map((p) => (
          <li key={p.proposal_id} className="rounded border border-slate-800 bg-slate-950 p-2">
            <p className="text-xs text-collab-teal-300">{p.agent_id ?? "agent"}</p>
            <p className="text-sm text-slate-100">{p.command_type}</p>
            {p.rationale && <p className="mt-1 text-xs text-slate-400">{p.rationale}</p>}
            <pre className="mt-1 overflow-x-auto text-[11px] text-slate-400">
              {JSON.stringify(p.payload, null, 2)}
            </pre>
            <div className="mt-2 flex gap-2">
              <Button variant="primary" size="sm" onClick={() => approve(p.proposal_id)}>
                Approve
              </Button>
              <Button variant="danger" size="sm" onClick={() => reject(p.proposal_id)}>
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </aside>
  );
}
