/**
 * Right-rail Members panel — Slack-style replacement for the cramped
 * "Members" tab inside ChannelDetailPanel.
 *
 * - Search input filters the existing roster in realtime.
 * - Each row shows avatar + presence dot + display name + role badge.
 * - Admins/owners see "Remove" on every other row.
 * - Inline invite picker reuses `useUsers` so we don't have to refetch.
 * - "Leave channel" CTA at the bottom dispatches `channel:leave`.
 *
 * The panel is a sibling of ThreadPane / AgentInbox in WorkspaceShell;
 * `useUi.membersPanelOpen` controls visibility.
 */
import {
  Avatar,
  Badge,
  Button,
  IconClose,
  IconLogOut,
  IconUserPlus,
  PresenceDot,
  type PresenceStatus as DotStatus,
} from "@collabai/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useDialogs } from "../lib/dialogs.tsx";
import { useTranslator } from "../lib/i18n/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type PresenceStatus } from "../state/sync.ts";
import { useToasts } from "../state/toasts.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
}

export function MembersPanel({ channelId }: { channelId: string }) {
  const open = useUi((s) => s.membersPanelOpen);
  const setOpen = useUi((s) => s.setMembersPanelOpen);
  const params = useParams<{ workspaceId: string }>();
  const navigate = useNavigate();
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const channel = useSync((s) => s.channels[channelId]);
  const presence = useSync((s) => s.presence);
  const usersById = useUsers((s) => s.byId);
  const pushToast = useToasts((s) => s.push);
  const qc = useQueryClient();
  const { t } = useTranslator();
  const { confirm } = useDialogs();
  const [query, setQuery] = useState("");
  const [showInvite, setShowInvite] = useState(false);

  const { data: members = [] } = useQuery({
    queryKey: ["channel-members", channelId],
    queryFn: () =>
      callFunction<MemberRow[]>("channel:list-members", { channel_id: channelId }),
    enabled: open && !!channelId,
    refetchOnWindowFocus: false,
  });

  const filtered = useMemo(() => {
    if (!query.trim()) return members;
    const q = query.toLowerCase();
    return members.filter(
      (m) =>
        m.display_name.toLowerCase().includes(q) ||
        m.user_id.toLowerCase().includes(q),
    );
  }, [members, query]);

  const myRow = members.find((m) => m.user_id === me);
  const canManage = myRow?.role === "owner" || myRow?.role === "admin";

  const candidateInvitees = useMemo(() => {
    const memberIds = new Set(members.map((m) => m.user_id));
    return Object.values(usersById).filter((u) => !memberIds.has(u.user_id));
  }, [members, usersById]);

  if (!open) return null;

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ["channel-members", channelId] });
  }

  async function remove(target: MemberRow) {
    const ok = await confirm({
      title: t("dialogs.removeMemberTitle"),
      description: t("members.removeConfirm", {
        name: target.display_name,
        channel: channel?.name ?? channelId,
      }),
      confirmLabel: t("members.remove"),
      destructive: true,
    });
    if (!ok) return;
    try {
      // The backend `channel:kick` function takes the target as `user_id`
      // (see `app/domain/channels/functions.py`). Anything else 422s.
      await callFunction("channel:kick", {
        channel_id: channelId,
        user_id: target.user_id,
      });
      await refresh();
    } catch (err) {
      console.error("channel:kick", err);
    }
  }

  async function leave() {
    const ok = await confirm({
      title: t("dialogs.leaveChannelTitle"),
      description: t("members.leaveConfirm", { channel: channel?.name ?? channelId }),
      confirmLabel: t("members.leaveChannel"),
      destructive: true,
    });
    if (!ok) return;
    try {
      await callFunction("channel:leave", { channel_id: channelId });
      setOpen(false);
      navigate(`/w/${params.workspaceId}`);
    } catch (err) {
      console.error("channel:leave", err);
    }
  }

  async function invite(userId: string) {
    try {
      // Backend `channel:invite` accepts a `user_ids` list — see
      // `app/domain/channels/functions.py`.
      await callFunction("channel:invite", {
        channel_id: channelId,
        user_ids: [userId],
      });
      pushToast({
        title: t("members.added"),
        description: usersById[userId]?.display_name ?? userId,
        tone: "success",
        durationMs: 2500,
      });
      await refresh();
    } catch (err) {
      console.error("channel:invite", err);
    }
  }

  return (
    <aside className="flex w-80 flex-col border-l border-border bg-surface">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="text-sm font-semibold text-foreground">
          {t("members.title")}{" "}
          <span className="text-tertiary">({members.length})</span>
        </h2>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("common.close")}
          className="rounded-md p-1 text-tertiary transition-colors hover:bg-hover hover:text-foreground"
        >
          <IconClose size={14} />
        </button>
      </header>
      <div className="border-b border-border p-3">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("members.search")}
          className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {canManage && (
          <button
            type="button"
            onClick={() => setShowInvite((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-2.5 text-sm text-accent transition-colors hover:bg-hover"
          >
            <IconUserPlus size={14} />
            {t("members.invite")}
          </button>
        )}
        {showInvite && canManage && (
          <InvitePicker
            candidates={candidateInvitees}
            onInvite={(id) => void invite(id)}
            placeholder={t("members.invitePlaceholder")}
            emptyLabel={t("members.noResults")}
          />
        )}
        <ul className="divide-y divide-border">
          {filtered.map((m) => (
            <MemberRowView
              key={m.user_id}
              row={m}
              presence={mapPresence(presence[m.user_id])}
              canManage={canManage && m.user_id !== me}
              onRemove={() => void remove(m)}
              t={t}
            />
          ))}
        </ul>
      </div>
      <footer className="border-t border-border p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void leave()}
          className="!w-full !justify-start !text-destructive"
        >
          <IconLogOut size={14} />
          <span className="ml-2">{t("members.leaveChannel")}</span>
        </Button>
      </footer>
    </aside>
  );
}

function MemberRowView({
  row,
  presence,
  canManage,
  onRemove,
  t,
}: {
  row: MemberRow;
  presence: DotStatus;
  canManage: boolean;
  onRemove: () => void;
  t: (key: string, vars?: Record<string, string | number>) => string;
}) {
  return (
    <li className="flex items-center justify-between gap-2 px-4 py-2.5 transition-colors hover:bg-hover">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="relative">
          <Avatar name={row.display_name} kind="human" size={28} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={presence} />
          </span>
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">
            {row.display_name}
          </p>
          <p className="truncate text-xs text-tertiary">
            {labelForRole(row.role, t)}
          </p>
        </div>
        {(row.role === "owner" || row.role === "admin") && (
          <Badge tone={row.role === "owner" ? "info" : "neutral"} className="!normal-case">
            {labelForRole(row.role, t)}
          </Badge>
        )}
      </div>
      {canManage && (
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-tertiary transition-colors hover:text-destructive"
        >
          {t("members.remove")}
        </button>
      )}
    </li>
  );
}

function InvitePicker({
  candidates,
  onInvite,
  placeholder,
  emptyLabel,
}: {
  candidates: Array<{ user_id: string; display_name: string }>;
  onInvite: (id: string) => void;
  placeholder: string;
  emptyLabel: string;
}) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!q.trim()) return candidates.slice(0, 8);
    const needle = q.toLowerCase();
    return candidates
      .filter(
        (c) =>
          c.display_name.toLowerCase().includes(needle) ||
          c.user_id.toLowerCase().includes(needle),
      )
      .slice(0, 8);
  }, [candidates, q]);
  return (
    <div className="border-b border-border px-3 pb-3">
      <input
        type="text"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder={placeholder}
        className="mb-2 w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {filtered.length === 0 ? (
        <p className="px-1 py-2 text-xs text-tertiary">{emptyLabel}</p>
      ) : (
        <ul className="space-y-0.5">
          {filtered.map((c) => (
            <li key={c.user_id}>
              <button
                type="button"
                onClick={() => onInvite(c.user_id)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
              >
                <Avatar name={c.display_name} kind="human" size={20} />
                <span className="truncate">{c.display_name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function labelForRole(
  role: string,
  t: (k: string) => string,
): string {
  switch (role) {
    case "owner":
      return t("members.owner");
    case "admin":
      return t("members.admin");
    default:
      return t("members.member");
  }
}

function mapPresence(s: PresenceStatus | undefined): DotStatus {
  switch (s) {
    case "active":
      return "online";
    case "away":
      return "idle";
    case "dnd":
      return "dnd";
    default:
      return "offline";
  }
}
