import { Button } from "@collabai/ui";
import { useState } from "react";
import { useNavigate } from "react-router";

export function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await fetch("/api/functions/auth:login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) throw new Error("Login failed");
      const body = (await res.json()) as { workspace_id: string };
      navigate(`/w/${body.workspace_id}`);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl"
      >
        <h1 className="mb-6 text-xl font-semibold text-collab-teal-300">collab.ai</h1>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-slate-300">Email</span>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"
          />
        </label>
        <label className="mb-4 block text-sm">
          <span className="mb-1 block text-slate-300">Password</span>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full rounded border border-slate-700 bg-slate-800 px-3 py-2 text-slate-100"
          />
        </label>
        {error && <p className="mb-3 text-sm text-rose-400">{error}</p>}
        <Button type="submit" variant="primary" className="w-full">
          Sign in
        </Button>
      </form>
    </main>
  );
}
