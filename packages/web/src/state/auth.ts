/**
 * Anonymous identity store.
 *
 * On first call to `bootstrap()` we read the per-browser identity from
 * localStorage (or mint a fresh one), tell the backend to register +
 * join the demo workspace via `demo:onboard`, and stash the resulting
 * IDs so every subsequent API call can attach `actor_id` /
 * `workspace_id` automatically.
 *
 * When mounted inside hof-os, the host calls `hydrate({identity,
 * workspaceId})` synchronously from JWT claims before any UI renders;
 * subsequent `bootstrap()` calls then short-circuit so the embed never
 * issues `demo:onboard` against the host's identity.
 */
import { create } from "zustand";
import { getOrCreateIdentity, type AnonymousIdentity } from "../lib/identity.ts";
import { runtimeApiBase, runtimeAuthHeaders } from "../lib/runtime-config.tsx";

// NOTE: this file deliberately does NOT import from `lib/api.ts` to avoid a
// circular dependency (api.ts reads the actor/workspace IDs from this
// store). We hand-roll a tiny unwrapping fetcher for the bootstrap path.
async function rawCall<T>(name: string, body: unknown): Promise<T> {
  const base = runtimeApiBase();
  const auth = await runtimeAuthHeaders();
  const res = await fetch(`${base}/api/functions/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...auth },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`call ${name} failed: ${res.status} ${text}`);
  }
  const envelope = (await res.json()) as { result?: T; error?: unknown };
  if (envelope && typeof envelope === "object" && envelope.error) {
    const err = envelope.error as { message?: string; code?: string } | string;
    const message = typeof err === "string" ? err : (err.message ?? err.code ?? "unknown error");
    throw new Error(`call ${name} failed: ${message}`);
  }
  return envelope.result as T;
}

export type AuthStatus = "idle" | "joining" | "ready" | "error";

export interface AuthState {
  status: AuthStatus;
  error: string | null;
  identity: AnonymousIdentity | null;
  workspaceId: string | null;
  defaultChannelId: string | null;
  bootstrap(): Promise<void>;
  /**
   * Host-driven identity injection. The hof-os embed mints a JWT with
   * `sub` (user id), `tid` (workspace id) and a display name and
   * passes them in here so the workspace shell can render without
   * ever calling `demo:onboard`. Idempotent.
   */
  hydrate(opts: HydrateOptions): void;
}

export interface HydrateOptions {
  identity: AnonymousIdentity;
  workspaceId: string;
  defaultChannelId?: string | null;
}

interface OnboardResponse {
  user_id: string;
  display_name: string;
  workspace_id: string;
  default_channel_id: string;
  error?: string;
}

let bootstrapPromise: Promise<void> | null = null;

export const useAuth = create<AuthState>((set, get) => ({
  status: "idle",
  error: null,
  identity: null,
  workspaceId: null,
  defaultChannelId: null,

  hydrate({ identity, workspaceId, defaultChannelId }) {
    set({
      identity,
      workspaceId,
      defaultChannelId: defaultChannelId ?? null,
      status: "ready",
      error: null,
    });
  },

  async bootstrap() {
    if (get().status === "ready") return;
    if (bootstrapPromise) return bootstrapPromise;

    set({ status: "joining", error: null });
    bootstrapPromise = (async () => {
      try {
        const identity = getOrCreateIdentity();
        const result = await rawCall<OnboardResponse>("demo:onboard", {
          user_id: identity.user_id,
          display_name: identity.display_name,
        });
        set({
          identity,
          workspaceId: result.workspace_id,
          defaultChannelId: result.default_channel_id,
          status: "ready",
          error: null,
        });
      } catch (err) {
        set({
          status: "error",
          error: err instanceof Error ? err.message : "Failed to join the demo workspace.",
        });
        throw err;
      } finally {
        bootstrapPromise = null;
      }
    })();
    return bootstrapPromise;
  },
}));
