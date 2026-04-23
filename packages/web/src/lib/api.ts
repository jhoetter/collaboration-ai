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

interface FunctionEnvelope<T> {
  result?: T;
  error?: { message?: string; code?: string } | string;
  duration_ms?: number;
  function?: string;
}

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
  // hof's @function HTTP layer wraps the handler's return value in
  // `{result, duration_ms, function}`; unwrap so callers see only their
  // own payload. Errors come back either as a non-2xx (handled above)
  // or as `{error: ...}` on the envelope.
  const envelope = (await res.json()) as FunctionEnvelope<T>;
  if (envelope && typeof envelope === "object" && "error" in envelope && envelope.error) {
    const message =
      typeof envelope.error === "string"
        ? envelope.error
        : (envelope.error.message ?? envelope.error.code ?? "unknown error");
    throw new Error(`call ${name} failed: ${message}`);
  }
  return envelope.result as T;
}

export async function callFunction<T = unknown>(
  name: string,
  body: Record<string, unknown> = {}
): Promise<T> {
  const { identity, workspaceId } = useAuth.getState();
  const merged: Record<string, unknown> = { ...body };
  if (identity && merged.actor_id === undefined) merged.actor_id = identity.user_id;
  if (workspaceId && merged.workspace_id === undefined) merged.workspace_id = workspaceId;
  return callFunctionRaw<T>(name, merged);
}
