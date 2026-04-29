/**
 * Cmd+K Spotlight palette — modeled on the `office-ai` shell palette.
 *
 * One unified, fuzzy-scored, keyboard-driven list. Items come from
 * four sources:
 *
 *   1. Actions   — declarative `PaletteCommand`s (create channel,
 *                  toggle language, sign out, …)
 *   2. Channels  — every joined room from the projection
 *   3. People    — every workspace member from the user directory
 *   4. Messages  — debounced full-text hits from `search:messages`
 *                  (only when the query is ≥ 2 chars)
 *
 * The palette persists "recent commands" in localStorage so the most
 * common actions float to the top when the user opens the palette
 * with no query — same UX trick the office-ai version uses.
 */
import { Avatar } from "@collabai/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { callFunction } from "../lib/api.ts";
import { clearIdentity } from "../lib/identity.ts";
import { useI18n, useTranslator } from "../lib/i18n/index.ts";
import { useChannelRoutePrefix } from "../lib/route-prefix.ts";
import { useSync, type PresenceStatus } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";

const RECENT_KEY = "collabai.palette.recent";
const RECENT_LIMIT = 6;
const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_CHARS = 2;

type ItemKind = "action" | "channel" | "person" | "message";

interface PaletteItem {
  readonly id: string;
  readonly kind: ItemKind;
  readonly label: string;
  readonly hint?: string;
  readonly shortcut?: string;
  readonly section: string;
  readonly icon?: ReactNode;
  readonly run: () => void | Promise<void>;
}

interface MessageHit {
  message_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  sequence: number;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [hits, setHits] = useState<MessageHit[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const debounceRef = useRef<number | null>(null);

  const { t } = useTranslator();
  const { locale, setLocale } = useI18n();
  const navigate = useNavigate();
  // See packages/web/src/lib/route-prefix.ts.
  const routePrefix = useChannelRoutePrefix();

  const channelMap = useSync((s) => s.channels);
  const usersById = useUsers((s) => s.byId);
  const channels = useMemo(() => Object.values(channelMap), [channelMap]);
  const users = useMemo(() => Object.values(usersById), [usersById]);

  const setCreateChannelOpen = useUi((s) => s.setCreateChannelOpen);
  const setNewDmOpen = useUi((s) => s.setNewDmOpen);

  const close = useCallback(() => setOpen(false), []);

  // ── ⌘K / Ctrl-K toggle ────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent | globalThis.KeyboardEvent) {
      const ke = e as globalThis.KeyboardEvent;
      if ((ke.metaKey || ke.ctrlKey) && ke.key.toLowerCase() === "k") {
        ke.preventDefault();
        ke.stopPropagation();
        ke.stopImmediatePropagation();
        setOpen((v) => !v);
      } else if (ke.key === "Escape" && open) {
        ke.preventDefault();
        close();
      }
    }
    window.addEventListener("keydown", onKey as EventListener, { capture: true });
    return () => window.removeEventListener("keydown", onKey as EventListener, { capture: true });
  }, [open, close]);

  // ── focus + reset on open ────────────────────────────────────────
  useEffect(() => {
    if (!open) {
      setQuery("");
      setActive(0);
      setHits([]);
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  // ── Build items ──────────────────────────────────────────────────
  const channelPath = useCallback(
    (channelId: string, suffix = "") => `${routePrefix}/c/${channelId}${suffix}`,
    [routePrefix]
  );

  const openDmWith = useCallback(
    async (userId: string) => {
      try {
        const res = await callFunction<{
          events: Array<{ room_id: string }>;
          dm_channel_id?: string;
        }>("dm:open", { participant_ids: [userId] });
        const room = res.dm_channel_id ?? res.events[0]?.room_id;
        if (room) navigate(channelPath(room));
      } catch (err) {
        console.error(err);
      }
    },
    [channelPath, navigate]
  );

  const actions = useMemo<PaletteItem[]>(() => {
    const sectionLabel = t("palette.sectionActions");
    const otherLocale = locale === "en" ? "de" : "en";
    return [
      {
        id: "action:create-channel",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionCreateChannel"),
        hint: t("palette.actionCreateChannelHint"),
        run: () => setCreateChannelOpen(true),
      },
      {
        id: "action:new-dm",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionNewDm"),
        hint: t("palette.actionNewDmHint"),
        run: () => setNewDmOpen(true),
      },
      {
        id: "action:toggle-language",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionToggleLanguage"),
        hint: t("palette.actionToggleLanguageHint", {
          a: t(locale === "en" ? "common.english" : "common.german"),
          b: t(otherLocale === "en" ? "common.english" : "common.german"),
        }),
        run: () => setLocale(otherLocale),
      },
      {
        id: "action:set-away",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionSetAway"),
        run: () => callFunction("users:set-presence", { status: "away" as PresenceStatus }),
      },
      {
        id: "action:set-active",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionSetActive"),
        run: () => callFunction("users:set-presence", { status: "active" as PresenceStatus }),
      },
      {
        id: "action:sign-out",
        kind: "action",
        section: sectionLabel,
        label: t("palette.actionSignOut"),
        hint: t("palette.actionSignOutHint"),
        run: () => {
          clearIdentity();
          location.reload();
        },
      },
    ];
  }, [t, locale, setLocale, setCreateChannelOpen, setNewDmOpen]);

  const channelItems = useMemo<PaletteItem[]>(() => {
    const sectionLabel = t("palette.sectionChannels");
    return channels
      .filter((c) => !c.archived && c.type !== "dm" && c.type !== "group_dm")
      .map((c) => ({
        id: `channel:${c.id}`,
        kind: "channel" as const,
        section: sectionLabel,
        label: `#${c.name}`,
        hint: c.topic || undefined,
        run: () => navigate(channelPath(c.id)),
      }));
  }, [channelPath, channels, navigate, t]);

  const peopleItems = useMemo<PaletteItem[]>(() => {
    const sectionLabel = t("palette.sectionPeople");
    return users.map((u) => ({
      id: `person:${u.user_id}`,
      kind: "person" as const,
      section: sectionLabel,
      label: u.display_name,
      hint: u.user_id,
      icon: <Avatar name={u.display_name} kind="human" size={20} />,
      run: () => openDmWith(u.user_id),
    }));
  }, [users, openDmWith, t]);

  const messageItems = useMemo<PaletteItem[]>(() => {
    const sectionLabel = t("palette.sectionMessages");
    return hits.map((h) => ({
      id: `message:${h.message_id}`,
      kind: "message" as const,
      section: sectionLabel,
      label: h.content,
      hint: `#${channelMap[h.channel_id]?.name ?? h.channel_id} · ${
        usersById[h.sender_id]?.display_name ?? h.sender_id
      }`,
      run: () => navigate(channelPath(h.channel_id, `#${h.message_id}`)),
    }));
  }, [channelPath, hits, channelMap, usersById, navigate, t]);

  const allItems = useMemo<PaletteItem[]>(
    () => [...actions, ...channelItems, ...peopleItems, ...messageItems],
    [actions, channelItems, peopleItems, messageItems]
  );

  // ── Debounced full-text message search ───────────────────────────
  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length < SEARCH_MIN_CHARS) {
      setHits([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void callFunction<MessageHit[]>("search:messages", { query: trimmed, limit: 8 })
        .then(setHits)
        .catch(() => setHits([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [query, open]);

  // ── Filtering + scoring ──────────────────────────────────────────
  const recents = useMemo(() => loadRecents(), [open]);

  const filtered = useMemo<PaletteItem[]>(() => {
    if (!open) return [];
    if (query.trim().length === 0) {
      const recentSet = new Set(recents);
      const recentHits = recents
        .map((id) => allItems.find((i) => i.id === id))
        .filter((i): i is PaletteItem => Boolean(i));
      const others = allItems.filter((i) => !recentSet.has(i.id));
      return [...recentHits, ...others].slice(0, 60);
    }
    const q = query.toLowerCase();
    return allItems
      .map((i) => ({ i, score: scoreMatch(i, q) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 60)
      .map((r) => r.i);
  }, [open, query, allItems, recents]);

  if (!open) return null;

  function pick(item: PaletteItem) {
    rememberRecent(item.id);
    close();
    void item.run();
  }

  function onInputKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[active];
      if (item) pick(item);
    }
  }

  // Group items by section to show small headers — but keep the
  // global keyboard cursor flat so ↑/↓ ignores section boundaries.
  let lastSection: string | null = null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("palette.title")}
      className="fixed inset-0 z-50 flex items-start justify-center bg-foreground/40 px-3 pt-[10vh] backdrop-blur-sm sm:px-4 sm:pt-[18vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      data-testid="command-palette"
    >
      <div className="w-full max-w-xl overflow-hidden rounded-lg border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-2 py-2">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKey}
            placeholder={t("palette.placeholder")}
            className="h-8 w-full rounded-md bg-transparent px-2 text-sm text-foreground outline-none placeholder:text-tertiary"
            data-testid="command-palette-input"
            aria-label={t("palette.search")}
          />
        </div>
        <div className="max-h-[60dvh] overflow-y-auto p-1 sm:max-h-[55vh]">
          {filtered.length === 0 ? (
            <div className="px-3 py-6 text-center text-sm text-tertiary">{t("palette.empty")}</div>
          ) : (
            filtered.map((item, idx) => {
              const showHeader = item.section !== lastSection;
              lastSection = item.section;
              return (
                <div key={item.id}>
                  {showHeader && (
                    <p className="px-2 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-tertiary">
                      {item.section}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={() => pick(item)}
                    onMouseEnter={() => setActive(idx)}
                    className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                      active === idx ? "bg-accent-light text-accent" : "text-foreground hover:bg-hover"
                    }`}
                    data-testid={`palette-cmd-${item.id}`}
                  >
                    {item.icon ? (
                      <span className="flex-shrink-0">{item.icon}</span>
                    ) : (
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-tertiary">
                        {iconForKind(item.kind)}
                      </span>
                    )}
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{item.label}</span>
                      {item.hint ? <span className="truncate text-xs text-tertiary">{item.hint}</span> : null}
                    </span>
                    {item.shortcut ? (
                      <span className="text-xs tabular-nums text-tertiary">{item.shortcut}</span>
                    ) : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="border-t border-border px-3 py-1.5 text-[10px] text-tertiary">
          ↑↓ · ↵ · Esc · {t("palette.shortcutCmdK")}
        </div>
      </div>
    </div>
  );
}

function iconForKind(kind: ItemKind): string {
  switch (kind) {
    case "channel":
      return "#";
    case "person":
      return "@";
    case "message":
      return "✎";
    case "action":
      return "⚡";
    default: {
      // Exhaustiveness check — TS will flag any new ItemKind.
      const _exhaustive: never = kind;
      return _exhaustive;
    }
  }
}

function scoreMatch(item: PaletteItem, q: string): number {
  const label = item.label.toLowerCase();
  const id = item.id.toLowerCase();
  const hint = (item.hint ?? "").toLowerCase();
  if (label === q) return 1000;
  if (label.startsWith(q)) return 500;
  if (label.includes(` ${q}`)) return 250;
  if (label.includes(q)) return 100;
  if (id.includes(q)) return 50;
  if (hint.includes(q)) return 25;
  // Acronym match: first letters of words.
  const initials = label
    .split(/\s+/)
    .map((w) => w[0] ?? "")
    .join("");
  if (initials.startsWith(q)) return 75;
  return 0;
}

function loadRecents(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function rememberRecent(id: string): void {
  if (typeof window === "undefined") return;
  try {
    const current = loadRecents();
    const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* localStorage may be unavailable (private mode) — silently ignore. */
  }
}
