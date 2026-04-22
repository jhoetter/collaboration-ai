/**
 * Channel settings dialog — name, topic, description, members,
 * archive / leave actions.
 *
 * The modal renders inline as a fixed overlay; closing dispatches the
 * `onClose` callback. Mutations call the corresponding `@function`
 * endpoints (`channel:update`, `channel:set-topic`, `channel:archive`
 * etc.) and rely on the WS event stream to refresh local projections.
 */
import { Avatar, Button, Modal } from "@collabai/ui";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { callFunction } from "../lib/api.ts";
import { useAuth } from "../state/auth.ts";
import type { Channel } from "../state/sync.ts";

interface MemberRow {
  user_id: string;
  display_name: string;
  role: string;
}

export function ChannelSettingsModal({
  channel,
  members,
  onClose,
}: {
  channel: Channel;
  members: MemberRow[];
  onClose: () => void;
}) {
  const me = useAuth((s) => s.identity?.user_id ?? null);
  const qc = useQueryClient();
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? "");
  const [description, setDescription] = useState(channel.description ?? "");
  const [tab, setTab] = useState<"about" | "members">("about");
  const [busy, setBusy] = useState(false);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["channel-members", channel.id] });
  }

  async function saveAbout() {
    setBusy(true);
    try {
      const payload: Record<string, unknown> = { channel_id: channel.id };
      if (name !== channel.name) payload.name = name;
      if (topic !== (channel.topic ?? "")) payload.topic = topic;
      if (description !== (channel.description ?? "")) payload.description = description;
      if (Object.keys(payload).length > 1) {
        await callFunction("channel:update", payload);
      }
    } finally {
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm(`Archive #${channel.name}?`)) return;
    setBusy(true);
    try {
      await callFunction("channel:archive", { channel_id: channel.id });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function leave() {
    if (!confirm(`Leave #${channel.name}?`)) return;
    setBusy(true);
    try {
      await callFunction("channel:leave", { channel_id: channel.id });
      onClose();
    } finally {
      setBusy(false);
    }
  }

  async function kick(userId: string) {
    if (!confirm(`Remove ${userId}?`)) return;
    setBusy(true);
    try {
      await callFunction("channel:kick", { channel_id: channel.id, user_id: userId });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} title={`#${channel.name}`}>
      <div className="border-b border-border">
        <nav className="flex">
          <TabButton active={tab === "about"} onClick={() => setTab("about")}>
            About
          </TabButton>
          <TabButton active={tab === "members"} onClick={() => setTab("members")}>
            Members ({members.length})
          </TabButton>
        </nav>
      </div>
      {tab === "about" ? (
        <div className="flex flex-col gap-3 p-4">
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </Field>
          <Field label="Topic">
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              placeholder="Add a topic"
            />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full resize-none rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              placeholder="What is this channel for?"
            />
          </Field>
          <div className="flex justify-between gap-2 pt-2">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => void leave()} disabled={busy}>
                Leave
              </Button>
              <Button variant="danger" size="sm" onClick={() => void archive()} disabled={busy || !!channel.archived}>
                Archive
              </Button>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={onClose} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void saveAbout()} disabled={busy}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <ul className="max-h-80 overflow-y-auto p-2">
          {members.map((m) => (
            <li
              key={m.user_id}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 transition-colors duration-150 hover:bg-hover"
            >
              <Avatar name={m.display_name} kind="human" size={28} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{m.display_name}</p>
                <p className="truncate text-xs text-tertiary">{m.role}</p>
              </div>
              {m.user_id !== me && (
                <button
                  type="button"
                  className="text-xs text-tertiary transition-colors hover:text-destructive"
                  onClick={() => void kick(m.user_id)}
                >
                  remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2 text-sm transition-colors duration-150 ${
        active
          ? "border-b-2 border-accent text-foreground"
          : "border-b-2 border-transparent text-secondary hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs uppercase tracking-wide text-tertiary">
      <span>{label}</span>
      {children}
    </label>
  );
}
