/**
 * Thin wrapper over fetch() that targets the hof-engine `@function`
 * HTTP endpoints exposed at /api/functions/<name>.
 */
export async function callFunction<T = unknown>(name: string, body: unknown): Promise<T> {
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
