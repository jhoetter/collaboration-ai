/**
 * Workspace top bar — Slack-style global search.
 *
 * The bar is the always-visible counterpart to the ⌘K command palette:
 * Cmd-K is for actions and navigation, the top bar is for content
 * discovery (messages, files, channels, people) with optional Slack-style
 * filter chips:
 *
 *   in:#general     restrict to a channel (also accepts the slug
 *                   without `#`, e.g. `in:general`).
 *   from:@alice     restrict to a sender (also accepts the user_id).
 *   has:file        only show messages that carry a non-link attachment.
 *
 * Chips are parsed inline; any free-text not matching a chip is the
 * fuzzy query forwarded to `search:messages`. Results render in a
 * grouped dropdown anchored under the bar.
 *
 * Selecting a result navigates to the appropriate channel (and message
 * permalink); pressing Enter on the input opens the first hit.
 */
import { Avatar, ChannelIcon, IconFile, IconHash, IconSearch } from "@collabai/ui";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import { useSync } from "../state/sync.ts";
import { useUi } from "../state/ui.ts";
import { useUsers } from "../state/users.ts";

const SEARCH_DEBOUNCE_MS = 200;
const SEARCH_MIN_CHARS = 2;

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
  users: ReturnType<typeof useUsers.getState>["byId"],
): ResolvedFilters {
  const channelIds = parsed.channels
    .map((slug) => {
      const hit = Object.values(channels).find(
        (c) => c.name?.toLowerCase() === slug,
      );
      return hit?.id;
    })
    .filter((x): x is string => Boolean(x));
  const senderIds = parsed.senders
    .map((needle) => {
      const hit = Object.values(users).find(
        (u) =>
          u.user_id.toLowerCase() === needle ||
          u.display_name.toLowerCase() === needle,
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

export function TopBar() {
  const { t } = useTranslator();
  const navigate = useNavigate();
  const params = useParams<{ workspaceId: string }>();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<MessageHit[]>([]);
  const [open, setOpen] = useState(false);
  const debounceRef = useRef<number | null>(null);

  const channels = useSync((s) => s.channels);
  const usersById = useUsers((s) => s.byId);
  const seedQuery = useUi((s) => s.searchQuery);
  const setSeedQuery = useUi((s) => s.setSearchQuery);

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

  // Cmd-G focuses the bar (Slack uses ⌘G as "find"); Esc clears.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "g") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

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
  const resolved = useMemo(
    () => resolveFilters(parsed, channels, usersById),
    [parsed, channels, usersById],
  );

  // Debounced server search.
  useEffect(() => {
    const trimmed = parsed.text;
    if (trimmed.length < SEARCH_MIN_CHARS && resolved.channelIds.length === 0 && resolved.senderIds.length === 0) {
      setHits([]);
      return;
    }
    if (debounceRef.current) window.clearTimeout(debounceRef.current);
    debounceRef.current = window.setTimeout(() => {
      void callFunction<MessageHit[]>("search:messages", {
        query: trimmed || "*",
        ...(resolved.channelIds.length === 1
          ? { channel_ids: resolved.channelIds }
          : resolved.channelIds.length > 1
          ? { channel_ids: resolved.channelIds }
          : {}),
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
        (c) =>
          !c.archived &&
          c.type !== "dm" &&
          c.type !== "group_dm" &&
          c.name?.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [channels, parsed.text]);

  const peopleMatches = useMemo(() => {
    const q = parsed.text.toLowerCase();
    if (q.length < 1) return [];
    return Object.values(usersById)
      .filter(
        (u) =>
          u.display_name.toLowerCase().includes(q) ||
          u.user_id.toLowerCase().includes(q),
      )
      .slice(0, 5);
  }, [usersById, parsed.text]);

  const fileHits = useMemo(
    () => filteredHits.filter((h) => h.has_files || (h.attachment_count ?? 0) > 0),
    [filteredHits],
  );

  const totalRows =
    filteredHits.length + channelMatches.length + peopleMatches.length + fileHits.length;

  const navigateToMessage = useCallback(
    (channelId: string, messageId: string) => {
      navigate(`/w/${params.workspaceId}/c/${channelId}#${messageId}`);
      setOpen(false);
    },
    [navigate, params.workspaceId],
  );

  const navigateToChannel = useCallback(
    (channelId: string) => {
      navigate(`/w/${params.workspaceId}/c/${channelId}`);
      setOpen(false);
    },
    [navigate, params.workspaceId],
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
          navigate(`/w/${params.workspaceId}/c/${room}`);
          setOpen(false);
        }
      } catch (err) {
        console.error(err);
      }
    },
    [navigate, params.workspaceId],
  );

  function pickFirst() {
    const first = filteredHits[0];
    if (first) {
      navigateToMessage(first.channel_id, first.message_id);
      return;
    }
    const ch = channelMatches[0];
    if (ch) {
      navigateToChannel(ch.id);
      return;
    }
    const u = peopleMatches[0];
    if (u) void openDmWith(u.user_id);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      if (query.length === 0) {
        inputRef.current?.blur();
      } else {
        setQuery("");
      }
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      pickFirst();
    }
  }

  const showDropdown = open && (totalRows > 0 || parsed.text.length >= SEARCH_MIN_CHARS);

  return (
    <div
      ref={containerRef}
      className="relative flex h-11 items-center justify-center border-b border-border bg-surface px-3"
    >
      <div className="relative w-full max-w-2xl">
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
          className="h-7 w-full rounded-md border border-border/60 bg-background pl-8 pr-3 text-sm text-foreground transition-colors placeholder:text-tertiary focus:border-accent/60 focus:outline-none focus:ring-2 focus:ring-accent/20"
          data-testid="topbar-search"
        />
      </div>
      {showDropdown && (
        <div className="absolute left-1/2 top-full z-40 mt-1 w-full max-w-2xl -translate-x-1/2 overflow-hidden rounded-md border border-border bg-card shadow-2xl">
          {parsed.text.length === 0 && totalRows === 0 ? (
            <div className="px-3 py-4 text-xs text-tertiary">
              {t("topbar.hint")}
            </div>
          ) : totalRows === 0 ? (
            <div className="px-3 py-4 text-sm text-tertiary">
              {t("topbar.noResults")}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto py-1">
              {channelMatches.length > 0 && (
                <Group label={t("topbar.groupChannels")}>
                  {channelMatches.map((c) => (
                    <ResultRow
                      key={c.id}
                      icon={
                        <ChannelIcon kind={c.private ? "private" : "public"} />
                      }
                      title={`#${c.name}`}
                      hint={c.topic ?? undefined}
                      onClick={() => navigateToChannel(c.id)}
                    />
                  ))}
                </Group>
              )}
              {peopleMatches.length > 0 && (
                <Group label={t("topbar.groupPeople")}>
                  {peopleMatches.map((u) => (
                    <ResultRow
                      key={u.user_id}
                      icon={<Avatar name={u.display_name} kind="human" size={20} />}
                      title={u.display_name}
                      hint={u.user_id}
                      onClick={() => void openDmWith(u.user_id)}
                    />
                  ))}
                </Group>
              )}
              {fileHits.length > 0 && (
                <Group label={t("topbar.groupFiles")}>
                  {fileHits.slice(0, 5).map((h) => (
                    <ResultRow
                      key={`file-${h.message_id}`}
                      icon={<IconFile />}
                      title={shorten(h.content) || `#${channels[h.channel_id]?.name ?? h.channel_id}`}
                      hint={`#${channels[h.channel_id]?.name ?? h.channel_id} · ${
                        usersById[h.sender_id]?.display_name ?? h.sender_id
                      }`}
                      onClick={() => navigateToMessage(h.channel_id, h.message_id)}
                    />
                  ))}
                </Group>
              )}
              {filteredHits.length > 0 && (
                <Group label={t("topbar.groupMessages")}>
                  {filteredHits.slice(0, 8).map((h) => (
                    <ResultRow
                      key={h.message_id}
                      icon={<IconHash />}
                      title={shorten(h.content)}
                      hint={`#${channels[h.channel_id]?.name ?? h.channel_id} · ${
                        usersById[h.sender_id]?.display_name ?? h.sender_id
                      }`}
                      onClick={() => navigateToMessage(h.channel_id, h.message_id)}
                    />
                  ))}
                </Group>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wider text-tertiary">
        {label}
      </p>
      {children}
    </div>
  );
}

function ResultRow({
  icon,
  title,
  hint,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground transition-colors hover:bg-hover"
    >
      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center text-tertiary">
        {icon}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate">{title}</span>
        {hint && <span className="truncate text-xs text-tertiary">{hint}</span>}
      </span>
    </button>
  );
}

function shorten(text: string, max = 80): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}
