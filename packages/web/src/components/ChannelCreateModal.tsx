/**
 * "Create a channel" dialog.
 *
 * The form mirrors Slack's: name, description, public/private. On
 * submit we call `channel:create`, then navigate the user to the new
 * channel (the WS event stream will surface it in the sidebar within
 * a frame).
 */
import { Button, Modal } from "@collabai/ui";
import { useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";

interface CreateChannelResponse {
  status: string;
  events: Array<{ room_id: string }>;
  error?: { code: string; message: string };
}

export function ChannelCreateModal({ onClose }: { onClose: () => void }) {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const { t } = useTranslator();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const slug = name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-|-$/g, "");
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
    <Modal title={t("channelCreate.title")} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-tertiary">
          <span>{t("common.name")}</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("channelCreate.namePlaceholder")}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            autoFocus
          />
        </label>
        <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-tertiary">
          <span>{t("channelCreate.topicPlaceholder")}</span>
          <textarea
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="h-4 w-4 rounded border-border text-accent focus:ring-accent/40"
          />
          <span>
            {t("channelCreate.private")} — {t("channelCreate.privateHint")}
          </span>
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void submit()} disabled={busy}>
            {t("common.create")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
