/**
 * Thin wrapper over fetch() that targets the hof-engine `@function`
 * HTTP endpoints exposed at /api/functions/<name>.
 *
 * `callFunction` automatically merges the caller's `actor_id` /
 * `workspace_id` from the anonymous-identity store into the request
 * body. Read-only handlers ignore the extra fields, so it is safe to
 * blanket-attach them to every call. The `*Raw` variant skips the
 * injection — used by the auth bootstrap (which has not yet hydrated
 * the store) and by tests that want full control over the payload.
 */
import { useAuth } from "../state/auth.ts";

export async function callFunctionRaw<T = unknown>(name: string, body: unknown): Promise<T> {
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

export async function callFunction<T = unknown>(
  name: string,
  body: Record<string, unknown> = {},
): Promise<T> {
  const { identity, workspaceId } = useAuth.getState();
  const merged: Record<string, unknown> = { ...body };
  if (identity && merged.actor_id === undefined) merged.actor_id = identity.user_id;
  if (workspaceId && merged.workspace_id === undefined) merged.workspace_id = workspaceId;
  return callFunctionRaw<T>(name, merged);
}
