/**
 * "Create a channel" dialog.
 *
 * The form mirrors Slack's: name, description, public/private. On
 * submit we call `channel:create`, then navigate the user to the new
 * channel (the WS event stream will surface it in the sidebar within
 * a frame).
 */
import { Button } from "@collabai/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { ModalShell } from "./ChannelSettingsModal.tsx";

interface CreateChannelResponse {
  status: string;
  events: Array<{ room_id: string }>;
  error?: { code: string; message: string };
}

export function ChannelCreateModal({ onClose }: { onClose: () => void }) {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) {
      setError("Pick a name for the channel.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callFunction<CreateChannelResponse>("channel:create", {
        name: slug,
        description: description.trim() || undefined,
        private: isPrivate,
      });
      if (res.status !== "applied" || res.events.length === 0) {
        setError(res.error?.message ?? "Could not create channel.");
        return;
      }
      const newId = res.events[0].room_id;
      onClose();
      navigate(`/w/${params.workspaceId}/c/${newId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Create a channel" onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
          <span>Name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. design-reviews"
            className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
            autoFocus
          />
          <span className="text-[10px] normal-case text-slate-500">
            Lowercase, no spaces. We'll slugify it for you.
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-slate-500">
          <span>Description (optional)</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-200">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
          />
          <span>Make private — invite only.</span>
        </label>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            Create
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
