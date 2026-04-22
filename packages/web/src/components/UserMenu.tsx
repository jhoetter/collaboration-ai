/**
 * Sidebar user popover.
 *
 * Shows the current user's avatar + display name with a dropdown for
 * editing the display name, setting an emoji status, toggling
 * away/active, switching theme + language, and signing out.
 */
import { Avatar, PresenceDot, ThemeToggle, type PresenceStatus as DotStatus } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { callFunction } from "../lib/api.ts";
import { clearIdentity } from "../lib/identity.ts";
import { LocaleToggle, useTranslator } from "../lib/i18n/index.ts";
import { useColorScheme } from "../lib/theme/index.ts";
import { useAuth } from "../state/auth.ts";
import { useSync, type PresenceStatus } from "../state/sync.ts";

export function UserMenu() {
  const identity = useAuth((s) => s.identity);
  const presence = useSync((s) => s.presence);
  const { t } = useTranslator();
  const { colorScheme, setColorScheme } = useColorScheme();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(identity?.display_name ?? "");
  const [statusEmoji, setStatusEmoji] = useState("");
  const [statusText, setStatusText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  const status = identity ? mapPresence(presence[identity.user_id]) : "offline";

  useEffect(() => {
    setDisplayName(identity?.display_name ?? "");
  }, [identity?.display_name]);

  useEffect(() => {
    function close(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  async function saveName() {
    const next = displayName.trim();
    if (!next || next === identity?.display_name) {
      setEditing(false);
      return;
    }
    await callFunction("users:set-display-name", { display_name: next });
    setEditing(false);
  }

  async function setStatus() {
    await callFunction("users:set-status", {
      emoji: statusEmoji || null,
      status_text: statusText || null,
    });
  }

  async function toggleAway() {
    const target: PresenceStatus = status === "idle" ? "active" : "away";
    await callFunction("users:set-presence", { status: target });
  }

  function signOut() {
    if (!confirm(t("userMenu.signOutConfirm"))) return;
    clearIdentity();
    location.reload();
  }

  return (
    <div ref={ref} className="relative mb-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 rounded-md bg-card px-2 py-2 text-left transition-colors duration-150 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="relative">
          <Avatar name={identity?.display_name ?? "anonymous"} kind="human" size={32} />
          <span className="absolute -bottom-0.5 -right-0.5">
            <PresenceDot status={status} />
          </span>
        </span>
        <span className="min-w-0">
          <p className="truncate text-xs text-tertiary">{t("userMenu.youAre")}</p>
          <p className="truncate text-sm font-semibold text-foreground">
            {identity?.display_name ?? t("userMenu.anonymous")}
          </p>
        </span>
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1.5 rounded-lg border border-border bg-card p-3 shadow-2xl">
          {editing ? (
            <div className="flex items-center gap-2">
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                autoFocus
              />
              <button
                type="button"
                onClick={() => void saveName()}
                className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
              >
                {t("common.save")}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
            >
              {t("userMenu.editDisplayName")}
            </button>
          )}
          <hr className="my-2 border-border" />
          <p className="px-2 text-[11px] font-semibold uppercase tracking-wide text-tertiary">
            {t("userMenu.setStatus")}
          </p>
          <div className="mt-1.5 flex items-center gap-1">
            <input
              value={statusEmoji}
              onChange={(e) => setStatusEmoji(e.target.value)}
              placeholder="🎯"
              maxLength={4}
              className="w-12 rounded-md border border-border bg-background px-2 py-1.5 text-center text-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <input
              value={statusText}
              onChange={(e) => setStatusText(e.target.value)}
              placeholder={t("userMenu.statusPlaceholder")}
              className="flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground placeholder:text-tertiary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
            <button
              type="button"
              onClick={() => void setStatus()}
              className="text-xs font-medium text-accent transition-opacity hover:opacity-80"
            >
              {t("common.save")}
            </button>
          </div>
          <hr className="my-2 border-border" />
          <button
            type="button"
            onClick={() => void toggleAway()}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
          >
            {status === "idle" ? t("userMenu.setActive") : t("userMenu.setAway")}
          </button>
          <hr className="my-2 border-border" />
          <div className="flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {t("userMenu.theme")}
            </span>
            <ThemeToggle value={colorScheme} onChange={setColorScheme} />
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 px-2 py-1">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-tertiary">
              {t("common.language")}
            </span>
            <LocaleToggle />
          </div>
          <hr className="my-2 border-border" />
          <button
            type="button"
            onClick={signOut}
            className="block w-full rounded-md px-2 py-1.5 text-left text-sm text-destructive transition-colors hover:bg-destructive-bg"
          >
            {t("userMenu.signOut")}
          </button>
        </div>
      )}
    </div>
  );
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
