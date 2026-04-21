/**
 * Anonymous identity store.
 *
 * On first call to `bootstrap()` we read the per-browser identity from
 * localStorage (or mint a fresh one), tell the backend to register +
 * join the demo workspace via `demo:onboard`, and stash the resulting
 * IDs so every subsequent API call can attach `actor_id` /
 * `workspace_id` automatically.
 *
 * There is no real auth here on purpose — when this app is mounted
 * inside hof-os the host owns identity and this store gets replaced
 * with a thin adapter over the host's session.
 */
import { create } from "zustand";
import { getOrCreateIdentity, type AnonymousIdentity } from "../lib/identity.ts";

async function rawCall<T>(name: string, body: unknown): Promise<T> {
  const res = await fetch(`/api/functions/${encodeURIComponent(name)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`call ${name} failed: ${res.status} ${text}`);
  }
  return (await res.json()) as T;
}

export type AuthStatus = "idle" | "joining" | "ready" | "error";

export interface AuthState {
  status: AuthStatus;
  error: string | null;
  identity: AnonymousIdentity | null;
  workspaceId: string | null;
  defaultChannelId: string | null;
  bootstrap(): Promise<void>;
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
