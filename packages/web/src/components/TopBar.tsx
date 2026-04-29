/**
 * Workspace top bar — Slack-style global search.
 *
 * The bar is the always-visible counterpart to the ⌘K command palette:
 * Cmd-K is for actions and navigation, the top bar is for content
 * discovery (messages, files, channels, people).
 *
 * Filter chips (parsed inline)
 * ----------------------------
 *   in:#general          Restrict to a channel (also accepts the slug
 *                        without `#`, e.g. `in:general`).
 *   from:@alice          Restrict to a sender (also accepts the user_id).
 *   has:file             Only show messages that carry a non-link
 *                        attachment.
 *   has:link             Only show messages that include a link.
 *
 * Suggestion buttons under the input let users discover those
 * modifiers without memorising the syntax.
 *
 * The result panel mirrors Slack's expanded search:
 *   - Recent searches (when the query is empty)
 *   - Tabs to filter by kind (All · Messages · Files · People · Channels)
 *   - Match-term highlighting
 *   - Keyboard navigation (↑/↓ to move, ↵ to open, Esc to clear/close)
 *   - Footer hint bar with the same shortcuts.
 */
import { Avatar, ChannelIcon, IconFile, IconHash, IconMenu, IconSearch } from "@collabai/ui";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useChannelRoutePrefix } from "../lib/route-prefix.ts";
import { useSync } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_CHARS = 2;
const RECENT_KEY = "collabai.search.recent";
const RECENT_LIMIT = 6;

interface MessageHit {
  message_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  sequence: number;
  has_files?: boolean;
  attachment_count?: number;
}

interface ParsedQuery {
  /** Free-text query forwarded to the server. */
  text: string;
  /** Channel slugs (without `#`) the user wants to scope to. */
  channels: string[];
  /** User identifiers (display name or user_id, lowercased). */
  senders: string[];
  /** True when the user typed `has:file`. */
  hasFile: boolean;
  /** True when the user typed `has:link`. */
  hasLink: boolean;
}

const CHIP_REGEX = /(?:^|\s)(in:#?[\w-]+|from:@?[\w-]+|has:[a-z]+)/gi;

export function parseQuery(raw: string): ParsedQuery {
  const channels: string[] = [];
  const senders: string[] = [];
  let hasFile = false;
  let hasLink = false;
  let text = ` ${raw} `;
  text = text.replace(CHIP_REGEX, (_match, token: string) => {
    const [k, v] = token.split(":");
    const key = k.toLowerCase();
    const value = v.replace(/^[#@]/, "").toLowerCase();
    if (key === "in" && value) channels.push(value);
    else if (key === "from" && value) senders.push(value);
    else if (key === "has" && value === "file") hasFile = true;
    else if (key === "has" && value === "link") hasLink = true;
    return " ";
  });
  return {
    text: text.trim().replace(/\s+/g, " "),
    channels,
    senders,
    hasFile,
    hasLink,
  };
}

interface ResolvedFilters {
  channelIds: string[];
  senderIds: string[];
  hasFile: boolean;
  hasLink: boolean;
}

function resolveFilters(
  parsed: ParsedQuery,
  channels: ReturnType<typeof useSync.getState>["channels"],
  users: ReturnType<typeof useUsers.getState>["byId"]
): ResolvedFilters {
  const channelIds = parsed.channels
    .map((slug) => {
      const hit = Object.values(channels).find((c) => c.name?.toLowerCase() === slug);
      return hit?.id;
    })
    .filter((x): x is string => Boolean(x));
  const senderIds = parsed.senders
    .map((needle) => {
      const hit = Object.values(users).find(
        (u) => u.user_id.toLowerCase() === needle || u.display_name.toLowerCase() === needle
      );
      return hit?.user_id;
    })
    .filter((x): x is string => Boolean(x));
  return {
    channelIds,
    senderIds,
    hasFile: parsed.hasFile,
    hasLink: parsed.hasLink,
  };
}

type Tab = "all" | "messages" | "files" | "people" | "channels";

const TAB_ORDER: Tab[] = ["all", "messages", "files", "people", "channels"];

interface FlatRow {
  key: string;
  pick: () => void;
  render: (active: boolean) => ReactNode;
  /** Which tab(s) this row belongs to. `all` is always implied. */
  tab: Exclude<Tab, "all">;
}

export function TopBar() {
  const { t } = useTranslator();
  const navigate = useNavigate();
  // See packages/web/src/lib/route-prefix.ts.
  const routePrefix = useChannelRoutePrefix();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef<Array<HTMLElement | null>>([]);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState<string[]>(() => loadRecents());
  const debounceRef = useRef<number | null>(null);

  const channels = useSync((s) => s.channels);
  const messageById = useSync((s) => s.messageById);
  const usersById = useUsers((s) => s.byId);
  const seedQuery = useUi((s) => s.searchQuery);
  const setSeedQuery = useUi((s) => s.setSearchQuery);
  const toggleSidebar = useUi((s) => s.toggleSidebar);

  // Pull seed pre-fills published from elsewhere (e.g. ChannelHeader's
  // "search in channel" button) and clear the slot so we don't loop.
  useEffect(() => {
    if (seedQuery == null) return;
    setQuery(seedQuery);
    setOpen(true);
    setSeedQuery(null);
    requestAnimationFrame(() => {
      inputRef.current?.focus();
      const len = seedQuery.length;
      inputRef.current?.setSelectionRange(len, len);
    });
  }, [seedQuery, setSeedQuery]);

  // Close the dropdown when the user clicks outside.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const parsed = useMemo(() => parseQuery(query), [query]);
  const resolved = useMemo(() => resolveFilters(parsed, channels, usersById), [parsed, channels, usersById]);

  // Reset the keyboard cursor whenever the result set could change.
  useEffect(() => {
    setActive(0);
  }, [query, tab]);

  // Debounced server search.
  useEffect(() => {
    const trimmed = parsed.text;
    if (
      trimmed.length < SEARCH_MIN_CHARS &&
      resolved.channelIds.length === 0 &&
      resolved.senderIds.length === 0
    ) {
      setHits([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void callFunction<MessageHit[]>("search:messages", {
        query: trimmed || "*",
        ...(resolved.channelIds.length > 0 ? { channel_ids: resolved.channelIds } : {}),
        ...(resolved.senderIds.length > 0 ? { sender_id: resolved.senderIds[0] } : {}),
        limit: 30,
      })
        .then(setHits)
        .catch(() => setHits([]));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
    };
  }, [parsed.text, resolved.channelIds, resolved.senderIds]);

  // Filter hits client-side by `has:file` since the projection's
  // attachment data is the source of truth for that flag.
  const filteredHits = useMemo(() => {
    if (!resolved.hasFile) return hits;
    return hits.filter((h) => h.has_files || (h.attachment_count ?? 0) > 0);
  }, [hits, resolved.hasFile]);

  const channelMatches = useMemo(() => {
    const q = parsed.text.toLowerCase();
    if (q.length < 1) return [];
    return Object.values(channels)
      .filter(
        (c) => !c.archived && c.type !== "dm" && c.type !== "group_dm" && c.name?.toLowerCase().includes(q)
      )
      .slice(0, 5);
  }, [channels, parsed.text]);

  const peopleMatches = useMemo(() => {
    const q = parsed.text.toLowerCase();
    if (q.length < 1) return [];
    return Object.values(usersById)
      .filter((u) => u.display_name.toLowerCase().includes(q) || u.user_id.toLowerCase().includes(q))
      .slice(0, 5);
  }, [usersById, parsed.text]);

  const fileHits = useMemo(
    () => filteredHits.filter((h) => h.has_files || (h.attachment_count ?? 0) > 0),
    [filteredHits]
  );

  // Terms used to highlight matches in result snippets/labels.
  const highlightTerms = useMemo(() => {
    if (parsed.text.length === 0) return [];
    return parsed.text
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 2);
  }, [parsed.text]);

  const navigateToMessage = useCallback(
    (channelId: string, messageId: string) => {
      navigate(`${routePrefix}/c/${channelId}#message-${messageId}`);
      setOpen(false);
      setRecents(rememberRecent(query));
    },
    [navigate, routePrefix, query]
  );

  const navigateToChannel = useCallback(
    (channelId: string) => {
      navigate(`${routePrefix}/c/${channelId}`);
      setOpen(false);
      setRecents(rememberRecent(query));
    },
    [navigate, routePrefix, query]
  );

  const openDmWith = useCallback(
    async (userId: string) => {
      try {
        const res = await callFunction<{
          events: Array<{ room_id: string }>;
          dm_channel_id?: string;
        }>("dm:open", { participant_ids: [userId] });
        const room = res.dm_channel_id ?? res.events[0]?.room_id;
        if (room) {
          navigate(`${routePrefix}/c/${room}`);
          setOpen(false);
          setRecents(rememberRecent(query));
        }
      } catch (err) {
        console.error(err);
      }
    },
    [navigate, routePrefix, query]
  );

  // Build a single flat row list so the keyboard cursor and the
  // rendering share one source of truth.
  const rows = useMemo<FlatRow[]>(() => {
    const out: FlatRow[] = [];
    for (const c of channelMatches) {
      out.push({
        key: `channel-${c.id}`,
        tab: "channels",
        pick: () => navigateToChannel(c.id),
        render: (isActive) => (
          <ResultRow
            active={isActive}
            icon={<ChannelIcon kind={c.private ? "private" : "public"} />}
            title={highlight(`#${c.name}`, highlightTerms)}
            hint={c.topic ?? undefined}
          />
        ),
      });
    }
    for (const u of peopleMatches) {
      out.push({
        key: `person-${u.user_id}`,
        tab: "people",
        pick: () => void openDmWith(u.user_id),
        render: (isActive) => (
          <ResultRow
            active={isActive}
            icon={<Avatar name={u.display_name} kind="human" size={20} />}
            title={highlight(u.display_name, highlightTerms)}
            hint={u.user_id}
          />
        ),
      });
    }
    for (const h of fileHits.slice(0, 6)) {
      const channel = channels[h.channel_id];
      const sender = usersById[h.sender_id];
      out.push({
        key: `file-${h.message_id}`,
        tab: "files",
        pick: () => navigateToMessage(h.channel_id, h.message_id),
        render: (isActive) => (
          <ResultRow
            active={isActive}
            icon={<IconFile size={14} />}
            title={
              shorten(h.content) ? (
                highlight(shorten(h.content), highlightTerms)
              ) : (
                <span className="text-tertiary">{channel ? `#${channel.name}` : h.channel_id}</span>
              )
            }
            hint={`${channel ? `#${channel.name}` : h.channel_id} · ${sender?.display_name ?? h.sender_id}`}
          />
        ),
      });
    }
    for (const h of filteredHits.slice(0, 12)) {
      const channel = channels[h.channel_id];
      const sender = usersById[h.sender_id];
      const ts = messageById[h.message_id]?.origin_ts;
      out.push({
        key: `msg-${h.message_id}`,
        tab: "messages",
        pick: () => navigateToMessage(h.channel_id, h.message_id),
        render: (isActive) => (
          <MessageRow
            active={isActive}
            content={h.content}
            terms={highlightTerms}
            sender={sender?.display_name ?? h.sender_id}
            senderImage={null}
            channel={channel ? `#${channel.name}` : `#${h.channel_id}`}
            timestamp={ts ? formatRelative(ts) : null}
          />
        ),
      });
    }
    return out;
  }, [
    channelMatches,
    peopleMatches,
    fileHits,
    filteredHits,
    channels,
    usersById,
    messageById,
    highlightTerms,
    navigateToChannel,
    openDmWith,
    navigateToMessage,
  ]);

  // Apply the active tab filter on top of the flat list.
  const visibleRows = useMemo(() => {
    if (tab === "all") return rows;
    return rows.filter((r) => r.tab === tab);
  }, [rows, tab]);

  // Scroll the active row into view as the user keyboard-navigates.
  useEffect(() => {
    const node = rowRefs.current[active];
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pickFirst() {
    const target = visibleRows[active] ?? visibleRows[0];
    if (target) target.pick();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query.length > 0) {
        setQuery("");
      } else if (open) {
        setOpen(false);
        inputRef.current?.blur();
      } else {
        inputRef.current?.blur();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(visibleRows.length - 1, i + 1));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === "Tab" && visibleRows.length > 0) {
      e.preventDefault();
      const idx = TAB_ORDER.indexOf(tab);
      const next = e.shiftKey
        ? (idx - 1 + TAB_ORDER.length) % TAB_ORDER.length
        : (idx + 1) % TAB_ORDER.length;
      setTab(TAB_ORDER[next] ?? "all");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      pickFirst();
    }
  }

  const tabCounts = useMemo<Record<Tab, number>>(
    () => ({
      all: rows.length,
      messages: rows.filter((r) => r.tab === "messages").length,
      files: rows.filter((r) => r.tab === "files").length,
      people: rows.filter((r) => r.tab === "people").length,
      channels: rows.filter((r) => r.tab === "channels").length,
    }),
    [rows]
  );

  const showEmptyState = query.length === 0;
  const showNoMatches = !showEmptyState && visibleRows.length === 0;
  const showDropdown = open;

  // Reset row refs each render so we can re-collect them in order.
  rowRefs.current = [];

  return (
    <div
      ref={containerRef}
      className="relative flex h-11 items-center gap-2 border-b border-border bg-surface px-2 sm:px-3 lg:justify-center"
    >
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label={t("sidebar.toggle")}
        title={t("sidebar.toggle")}
        className="-ml-1 inline-flex h-9 w-9 items-center justify-center rounded-md text-secondary transition-colors hover:bg-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 lg:hidden"
      >
        <IconMenu size={18} />
      </button>
      <div className="relative min-w-0 flex-1 md:max-w-2xl">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-tertiary">
          <IconSearch size={14} />
        </span>
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={t("topbar.placeholder")}
          aria-label={t("topbar.placeholder")}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls="topbar-search-listbox"
          aria-activedescendant={visibleRows[active] ? `topbar-row-${visibleRows[active].key}` : undefined}
          className="h-8 w-full rounded-md border border-hairline bg-background pl-8 pr-3 text-sm text-foreground transition-colors placeholder:text-tertiary focus:border-accent-faint focus:outline-none focus:ring-2 focus:ring-accent-dim sm:h-7 sm:pr-12"
          data-testid="topbar-search"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 text-[10px] text-tertiary sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>F</Kbd>
        </span>
      </div>
      {showDropdown && (
        <div
          id="topbar-search-listbox"
          role="listbox"
          className="absolute left-1/2 top-full z-40 mt-1 flex max-h-[80dvh] w-[min(48rem,calc(100vw-1rem))] -translate-x-1/2 flex-col overflow-hidden rounded-md border border-border bg-card shadow-2xl"
        >
          <Tabs tab={tab} counts={tabCounts} onChange={setTab} t={t} />
          <ChipSuggestions
            parsed={parsed}
            currentChannelName={findCurrentChannelName(channels, location.pathname)}
            onAppend={(chip) => {
              setQuery((q) => (q.endsWith(" ") || q.length === 0 ? `${q}${chip} ` : `${q} ${chip} `));
              inputRef.current?.focus();
            }}
            t={t}
          />
          <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
            {showEmptyState && recents.length > 0 && (
              <Group label={t("topbar.recentSearches")}>
                {recents.map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => {
                      setQuery(r);
                      inputRef.current?.focus();
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
                  >
                    <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-tertiary">
                      <IconSearch size={12} />
                    </span>
                    <span className="truncate">{r}</span>
                  </button>
                ))}
              </Group>
            )}
            {showEmptyState && recents.length === 0 && (
              <div className="px-3 py-4 text-xs text-tertiary">{t("topbar.hint")}</div>
            )}
            {showNoMatches && <div className="px-3 py-4 text-sm text-tertiary">{t("topbar.noResults")}</div>}
            {!showEmptyState && visibleRows.length > 0 && (
              <div>
                {visibleRows.map((row, idx) => (
                  <div
                    key={row.key}
                    id={`topbar-row-${row.key}`}
                    role="option"
                    aria-selected={active === idx}
                    ref={(el) => {
                      rowRefs.current[idx] = el;
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActive(idx);
                        row.pick();
                      }}
                      onMouseEnter={() => setActive(idx)}
                      className="block w-full text-left"
                    >
                      {row.render(active === idx)}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <FooterHint t={t} />
        </div>
      )}
    </div>
  );
}

function Tabs({
  tab,
  counts,
  onChange,
  t,
}: {
  tab: Tab;
  counts: Record<Tab, number>;
  onChange: (next: Tab) => void;
  t: ReturnType<typeof useTranslator>["t"];
}) {
  const labels: Record<Tab, string> = {
    all: t("topbar.tabAll"),
    messages: t("topbar.tabMessages"),
    files: t("topbar.tabFiles"),
    people: t("topbar.tabPeople"),
    channels: t("topbar.tabChannels"),
  };
  return (
    <div className="flex items-center gap-1 border-b border-border px-2 py-1.5">
      {TAB_ORDER.map((id) => {
        const isActive = id === tab;
        const count = counts[id];
        return (
          <button
            key={id}
            type="button"
            onMouseDown={(e) => {
              // Prevent the input from losing focus when clicking a tab.
              e.preventDefault();
            }}
            onClick={() => onChange(id)}
            className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition-colors ${
              isActive ? "bg-accent-light text-accent" : "text-secondary hover:bg-hover hover:text-foreground"
            }`}
          >
            <span>{labels[id]}</span>
            {count > 0 && (
              <span
                className={`rounded px-1 text-[10px] tabular-nums ${
                  isActive ? "text-accent" : "text-tertiary"
                }`}
              >
                {count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function ChipSuggestions({
  parsed,
  currentChannelName,
  onAppend,
  t,
}: {
  parsed: ParsedQuery;
  currentChannelName: string | null;
  onAppend: (chip: string) => void;
  t: ReturnType<typeof useTranslator>["t"];
}) {
  const chips: Array<{ id: string; label: string; chip: string; show: boolean }> = [
    {
      id: "in-channel",
      label: t("topbar.chipInCurrentChannel", { name: currentChannelName ?? "" }),
      chip: currentChannelName ? `in:#${currentChannelName}` : "",
      show: !!currentChannelName && parsed.channels.length === 0,
    },
    {
      id: "has-file",
      label: t("topbar.chipHasFile"),
      chip: "has:file",
      show: !parsed.hasFile,
    },
    {
      id: "has-link",
      label: t("topbar.chipHasLink"),
      chip: "has:link",
      show: !parsed.hasLink,
    },
  ].filter((c) => c.show && c.chip);
  if (chips.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-border px-2 py-1.5">
      {chips.map((c) => (
        <button
          key={c.id}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onAppend(c.chip)}
          className="rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-secondary transition-colors hover:border-reaction-pill hover:text-foreground"
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

function FooterHint({ t }: { t: ReturnType<typeof useTranslator>["t"] }) {
  return (
    <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10px] text-tertiary">
      <span className="flex items-center gap-1">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd>
        <span>{t("topbar.footerNavigate")}</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>↵</Kbd>
        <span>{t("topbar.footerOpen")}</span>
      </span>
      <span className="flex items-center gap-1">
        <Kbd>Esc</Kbd>
        <span>{t("topbar.footerClose")}</span>
      </span>
      <span className="ml-auto flex items-center gap-1">
        <Kbd>⌘</Kbd>
        <Kbd>F</Kbd>
        <span>{t("topbar.footerFocus")}</span>
      </span>
    </div>
  );
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-tertiary">{label}</p>
      {children}
    </div>
  );
}

function ResultRow({
  active,
  icon,
  title,
  hint,
}: {
  active: boolean;
  icon: ReactNode;
  title: ReactNode;
  hint?: string;
}) {
  return (
    <div
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-sm transition-colors ${
        active ? "bg-accent-light text-accent" : "text-foreground"
      }`}
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-tertiary">{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {hint && <span className="truncate text-xs text-tertiary">{hint}</span>}
      </span>
    </div>
  );
}

function MessageRow({
  active,
  content,
  terms,
  sender,
  channel,
  timestamp,
}: {
  active: boolean;
  content: string;
  terms: string[];
  sender: string;
  senderImage: string | null;
  channel: string;
  timestamp: string | null;
}) {
  return (
    <div
      className={`flex w-full items-start gap-2 px-3 py-2 text-sm transition-colors ${
        active ? "bg-accent-light text-accent" : "text-foreground"
      }`}
    >
      <span className="mt-0.5 flex-shrink-0">
        <Avatar name={sender} kind="human" size={24} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-2 text-xs text-tertiary">
          <span className="truncate font-medium text-secondary">{sender}</span>
          <span className="flex items-center gap-0.5">
            <IconHash size={10} />
            <span className="truncate">{channel.replace(/^#/, "")}</span>
          </span>
          {timestamp && <span>· {timestamp}</span>}
        </span>
        <span className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-foreground">
          {highlight(content, terms)}
        </span>
      </span>
    </div>
  );
}

function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-4 min-w-[1rem] items-center justify-center rounded border border-border bg-background px-1 text-[10px] font-medium leading-none text-secondary">
      {children}
    </kbd>
  );
}

function shorten(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * Wrap each occurrence of any term in `<mark>` so the user can scan
 * results faster. Case-insensitive, longest-term-first to avoid
 * shorter terms eating substrings of longer ones.
 */
export function highlight(text: string, terms: string[]): ReactNode {
  if (text.length === 0 || terms.length === 0) return text;
  const safe = terms
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .sort((a, b) => b.length - a.length);
  if (safe.length === 0) return text;
  const re = new RegExp(`(${safe.join("|")})`, "gi");
  const parts = text.split(re);
  return parts.map((part, idx) => {
    if (idx % 2 === 1) {
      return (
        <mark key={idx} className="rounded-sm bg-accent-light px-0.5 text-accent">
          {part}
        </mark>
      );
    }
    return <span key={idx}>{part}</span>;
  });
}

export function loadRecents(): string[] {
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

export function rememberRecent(query: string): string[] {
  const trimmed = query.trim();
  if (typeof window === "undefined" || trimmed.length === 0) return loadRecents();
  try {
    const current = loadRecents();
    const next = [trimmed, ...current.filter((x) => x !== trimmed)].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    return next;
  } catch {
    return loadRecents();
  }
}

function formatRelative(ts: number): string {
  const now = Date.now();
  const diff = now - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d`;
  const date = new Date(ts);
  return date.toLocaleDateString();
}

/**
 * Resolve the channel name for the URL the user is currently on, but
 * only for "real" rooms — DM/group-DM channel names are synthesized
 * server-side as `DM dm_<id>` and would render as a cryptic chip
 * (e.g. "In #DM dm_4aa3f3de7188"). For those rooms we'd advertise no
 * scope chip; the user can still type `from:@partner` themselves.
 */
function findCurrentChannelName(
  channels: ReturnType<typeof useSync.getState>["channels"],
  pathname: string
): string | null {
  const m = pathname.match(/\/c\/([^/?#]+)/);
  if (!m) return null;
  const channel = channels[m[1]];
  if (!channel) return null;
  if (channel.type === "dm" || channel.type === "group_dm") return null;
  return channel.name ?? null;
}
