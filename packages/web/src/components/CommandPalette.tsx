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
import {
  CommandPalette as HofCommandPalette,
  createAppLinkCommands,
  useShortcut,
  type CommandItem,
} from "@hofos/ux";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { createHandoffAppLinks, navigateHandoffHref } from "../lib/hofShellNavigation.ts";
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
  const [hits, setHits] = useState<MessageHit[]>([]);
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

  useShortcut(
    useMemo(
      () => [
        {
          key: "k",
          meta: true,
          description: "Toggle command palette",
          run: () => setOpen((value) => !value),
        },
      ],
      []
    )
  );

  useEffect(() => {
    const onOpenPalette = () => setOpen(true);
    window.addEventListener("collabai:open-command-palette", onOpenPalette);
    return () => window.removeEventListener("collabai:open-command-palette", onOpenPalette);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
    }
  }, [open]);

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
      ...createAppLinkCommands(
        createHandoffAppLinks({ selfAppId: "collabai", selfHref: "/" }),
        { navigate: (href) => navigateHandoffHref(href) }
      ).map((cmd) => ({
        id: cmd.id,
        kind: "action" as const,
        section: cmd.group,
        label: String(cmd.label),
        hint: "Switch app",
        run: cmd.perform ?? (() => undefined),
      })),
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

  function pick(item: PaletteItem) {
    rememberRecent(item.id);
    close();
    void item.run();
  }

  const commands = filtered.map<CommandItem>((item) => ({
    id: item.id,
    group: item.section,
    label: item.label,
    icon: item.icon ?? iconForKind(item.kind),
    hint: item.hint,
    shortcut: item.shortcut,
    perform: () => pick(item),
    keywords: [item.label, item.hint ?? "", item.section, item.id],
  }));

  return (
    <HofCommandPalette
      open={open}
      onOpenChange={setOpen}
      commands={commands}
      inputValue={query}
      onInputValueChange={setQuery}
      shouldFilter={false}
      emptyLabel={t("palette.empty")}
    />
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
