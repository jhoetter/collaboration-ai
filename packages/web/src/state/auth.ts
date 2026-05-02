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
  bootstrapFromSession(): Promise<boolean>;
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

interface SessionIdentityResponse {
  userId?: string | null;
  actorId?: string | null;
  tenantId?: string | null;
  workspaceId?: string | null;
  email?: string | null;
  displayName?: string | null;
  name?: string | null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function fetchSessionIdentity(): Promise<SessionIdentityResponse | null> {
  const base = runtimeApiBase();
  const auth = await runtimeAuthHeaders();
  const res = await fetch(`${base}/api/me`, {
    credentials: "include",
    headers: { Accept: "application/json", ...auth },
  });
  if (!res.ok) return null;
  return (await res.json().catch(() => null)) as SessionIdentityResponse | null;
}

let bootstrapPromise: Promise<void> | null = null;
let sessionBootstrapPromise: Promise<boolean> | null = null;

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

  async bootstrapFromSession() {
    if (get().status === "ready") return true;
    if (sessionBootstrapPromise) return sessionBootstrapPromise;

    set({ status: "joining", error: null });
    sessionBootstrapPromise = (async () => {
      try {
        const session = await fetchSessionIdentity();
        const userId = text(session?.userId) ?? text(session?.actorId);
        const workspaceId = text(session?.tenantId) ?? text(session?.workspaceId);
        if (!userId || !workspaceId) return false;

        const displayName =
          text(session?.displayName) ?? text(session?.name) ?? text(session?.email) ?? userId;
        set({
          identity: { user_id: userId, display_name: displayName },
          workspaceId,
          defaultChannelId: null,
          status: "ready",
          error: null,
        });
        return true;
      } catch {
        return false;
      } finally {
        sessionBootstrapPromise = null;
      }
    })();
    return sessionBootstrapPromise;
  },

  async bootstrap() {
    if (get().status === "ready") return;
    if (bootstrapPromise) return bootstrapPromise;

    set({ status: "joining", error: null });
    bootstrapPromise = (async () => {
      try {
        if (await get().bootstrapFromSession()) return;
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
