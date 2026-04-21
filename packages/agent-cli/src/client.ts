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

  send(
    channelId: string,
    content: string,
    extra: { thread_root?: string; mentions?: string[] } = {},
  ): Promise<CommandResult> {
    return this.call<CommandResult>("chat:send-message", {
      channel_id: channelId,
      content,
      ...extra,
    });
  }

  /** Newest-first message slice for a channel. `since_sequence`
   * lets the caller poll for incremental updates. */
  read(
    channelId: string,
    opts: { since?: number; limit?: number } = {},
  ): Promise<unknown[]> {
    return this.call("chat:list-messages", {
      channel_id: channelId,
      since_sequence: opts.since ?? 0,
      limit: opts.limit ?? 100,
    });
  }

  search(
    query: string,
    opts: { channel_ids?: string[]; from_user?: string; limit?: number } = {},
  ): Promise<unknown[]> {
    return this.call("chat:search", { query, ...opts });
  }

  addReaction(targetEventId: string, emoji: string): Promise<CommandResult> {
    return this.call<CommandResult>("chat:add-reaction", {
      target_event_id: targetEventId,
      emoji,
    });
  }

  unread(): Promise<Array<{ channel_id: string; unread: number; mention_count: number }>> {
    return this.call("unread:by-channel", {});
  }

  notifications(limit = 50): Promise<unknown[]> {
    return this.call("notifications:list", { limit });
  }

  channels(): Promise<unknown[]> {
    return this.call("channel:list", {});
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

  /** Poll the event log and yield events as they arrive.
   *
   * Uses ``events:list`` with a short sleep between empty polls. The
   * cursor is the workspace-monotonic ``sequence`` field of the last
   * event yielded — callers can persist + resume from it. */
  async *subscribe(opts: { since?: number; pollMs?: number } = {}): AsyncGenerator<{ sequence: number }> {
    let cursor = opts.since ?? 0;
    const pollMs = opts.pollMs ?? 1500;
    for (;;) {
      const events = (await this.call<Array<{ sequence: number }>>(
        "events:list",
        { since_sequence: cursor, limit: 200 },
      )) as Array<{ sequence: number }>;
      for (const evt of events) {
        yield evt;
        if (evt.sequence > cursor) cursor = evt.sequence;
      }
      if (events.length === 0) {
        await new Promise((r) => setTimeout(r, pollMs));
      }
    }
  }
}
