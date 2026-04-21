import { request } from "undici";

export type CommandResult = {
  command_id: string;
  status: "applied" | "staged" | "rejected" | "failed";
  events: Array<{ event_id: string; type: string; sequence: number }>;
  proposal_id?: string;
  error?: { code: string; message: string; field?: string };
};

export interface CollabClientOptions {
  baseUrl: string;
  token: string;
  workspaceId: string;
  /** Default actor id; for agent CLI use, this is the agent id. */
  actorId: string;
  fetchImpl?: typeof globalThis.fetch;
}

export class CollabClient {
  constructor(private readonly opts: CollabClientOptions) {}

  /** Generic POST to a `/api/functions/<name>` endpoint. */
  async call<TOut>(name: string, body: Record<string, unknown> = {}): Promise<TOut> {
    const url = `${this.opts.baseUrl.replace(/\/$/, "")}/api/functions/${name}`;
    const payload = {
      workspace_id: this.opts.workspaceId,
      actor_id: this.opts.actorId,
      ...body,
    };
    const res = await request(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.opts.token}`,
      },
      body: JSON.stringify(payload),
    });
    const text = await res.body.text();
    if (res.statusCode >= 400) {
      throw new Error(`function ${name} failed: ${res.statusCode} ${text}`);
    }
    return JSON.parse(text) as TOut;
  }

  send(channelId: string, content: string): Promise<CommandResult> {
    return this.call<CommandResult>("chat:send-message", {
      channel_id: channelId,
      content,
    });
  }

  unread(): Promise<Array<{ channel_id: string; unread: number; mention_count: number }>> {
    return this.call("unread:by-channel", {});
  }

  notifications(limit = 50): Promise<unknown[]> {
    return this.call("notifications:list", { limit });
  }

  approveProposal(proposalId: string): Promise<CommandResult> {
    return this.call<CommandResult>("agent:approve-proposal", {
      proposal_id: proposalId,
    });
  }

  rejectProposal(proposalId: string, reason?: string): Promise<CommandResult> {
    return this.call<CommandResult>("agent:reject-proposal", {
      proposal_id: proposalId,
      reason,
    });
  }
}
