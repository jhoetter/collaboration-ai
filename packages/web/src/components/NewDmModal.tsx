/**
 * "New direct message" dialog.
 *
 * Lists workspace members; selecting one (or many for a group DM)
 * opens a DM channel via `dm:open`. The backend dedupes by member set,
 * so reopening an existing 1-1 DM just navigates to it.
 */
import { Avatar, Button } from "@collabai/ui";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useUsers } from "../state/users.ts";
import { ModalShell } from "./ChannelSettingsModal.tsx";

interface DmOpenResponse {
  status: string;
  events: Array<{ room_id: string }>;
  dm_channel_id?: string;
  error?: { code: string; message: string };
}

export function NewDmModal({ onClose }: { onClose: () => void }) {
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const usersById = useUsers((s) => s.byId);
  const { t } = useTranslator();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      Object.values(usersById)
        .filter((u) => u.user_id !== me)
        .filter(
          (u) =>
            !query ||
            u.display_name.toLowerCase().includes(query.toLowerCase()) ||
            u.user_id.toLowerCase().includes(query.toLowerCase()),
        )
        .slice(0, 50),
    [usersById, me, query],
  );

  function toggle(id: string) {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function open() {
    if (picked.size === 0) {
      setError(t("dm.pickAtLeastOne"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await callFunction<DmOpenResponse>("dm:open", {
        participant_ids: Array.from(picked),
      });
      if (res.status !== "applied") {
        setError(res.error?.message ?? t("dm.couldNotOpen"));
        return;
      }
      const newId = res.dm_channel_id ?? res.events[0]?.room_id;
      if (!newId) {
        setError(t("dm.couldNotResolve"));
        return;
      }
      onClose();
      navigate(`/w/${params.workspaceId}/c/${newId}`);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={t("dm.newTitle")} onClose={onClose}>
      <div className="flex flex-col gap-3 p-4">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("dm.to")}
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-100"
          autoFocus
        />
        {picked.size > 0 && (
          <div className="flex flex-wrap gap-1">
            {Array.from(picked).map((id) => {
              const u = usersById[id];
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggle(id)}
                  className="flex items-center gap-1 rounded-full border border-slate-700 bg-slate-800 px-2 py-0.5 text-xs text-slate-200"
                >
                  <span>{u?.display_name ?? id}</span>
                  <span className="text-slate-500">✕</span>
                </button>
              );
            })}
          </div>
        )}
        <ul className="max-h-72 overflow-y-auto rounded border border-slate-800">
          {candidates.length === 0 ? (
            <li className="p-3 text-xs text-slate-500">{t("common.noMatches")}</li>
          ) : (
            candidates.map((u) => (
              <li key={u.user_id}>
                <button
                  type="button"
                  onClick={() => toggle(u.user_id)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${
                    picked.has(u.user_id) ? "bg-slate-800" : "hover:bg-slate-800"
                  }`}
                >
                  <Avatar name={u.display_name} kind="human" size={24} />
                  <span className="flex-1 truncate text-slate-100">{u.display_name}</span>
                  <span className="text-xs text-slate-500">{u.user_id}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        {error && <p className="text-xs text-rose-400">{error}</p>}
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={() => void open()} disabled={busy}>
            {t("dm.open")}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
