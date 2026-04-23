/**
 * Convert `:shortcode:` tokens (Slack/Discord/GitHub style) into the
 * matching native unicode emoji.
 *
 * Backed by the same `@emoji-mart/data` payload the picker already
 * loads, so we don't add a separate dictionary or pay an extra bundle
 * cost. The lookup index is built lazily on first use.
 *
 * The token grammar matches what `emoji-mart` itself accepts: ASCII
 * letters, digits, `_`, `+`, `-`. We deliberately do not match anything
 * containing `:` so URLs (`https://...`) or markdown link syntax cannot
 * be mangled.
 */
import data from "@emoji-mart/data";
import { $getRoot, $isTextNode, type LexicalEditor } from "lexical";

interface EmojiSkin {
  native: string;
}

interface EmojiEntry {
  id: string;
  skins: EmojiSkin[];
}

interface EmojiData {
  emojis: Record<string, EmojiEntry>;
  aliases: Record<string, string>;
}

/** A single suggestion shown in the autocomplete popover. */
export interface EmojiSuggestion {
  /** Canonical shortcode without colons. */
  shortcode: string;
  /** Native unicode emoji. */
  native: string;
}

let lookup: Map<string, string> | null = null;
let suggestions: EmojiSuggestion[] | null = null;

function buildLookup(): Map<string, string> {
  const map = new Map<string, string>();
  const typed = data as unknown as EmojiData;
  for (const [id, entry] of Object.entries(typed.emojis ?? {})) {
    const native = entry.skins?.[0]?.native;
    if (native) map.set(id.toLowerCase(), native);
  }
  for (const [alias, id] of Object.entries(typed.aliases ?? {})) {
    const native = map.get(id.toLowerCase());
    if (native) map.set(alias.toLowerCase(), native);
  }
  return map;
}

/**
 * Build a flat, alphabetised list of `(shortcode, native)` pairs once
 * so the autocomplete popover can filter without re-walking the data
 * payload on every keystroke.
 */
function buildSuggestions(): EmojiSuggestion[] {
  const typed = data as unknown as EmojiData;
  const out: EmojiSuggestion[] = [];
  for (const [id, entry] of Object.entries(typed.emojis ?? {})) {
    const native = entry.skins?.[0]?.native;
    if (native) out.push({ shortcode: id.toLowerCase(), native });
  }
  out.sort((a, b) => a.shortcode.localeCompare(b.shortcode));
  return out;
}

/** Returns the native emoji for a shortcode (without the colons), or null. */
export function shortcodeToNative(code: string): string | null {
  if (!code) return null;
  if (!lookup) lookup = buildLookup();
  return lookup.get(code.toLowerCase()) ?? null;
}

/**
 * Filter the shortcode index by `query` (without the leading colon).
 *
 * Ranks `startsWith` matches above substring matches and caps the
 * result so the popover stays a manageable size. An empty query
 * returns the first `limit` entries alphabetically — handy for the
 * "I just typed `:`" case so the user immediately sees there is
 * something to pick.
 */
export function searchEmojiShortcodes(query: string, limit = 8): EmojiSuggestion[] {
  if (!suggestions) suggestions = buildSuggestions();
  const q = query.toLowerCase();
  if (!q) return suggestions.slice(0, limit);
  const prefix: EmojiSuggestion[] = [];
  const contains: EmojiSuggestion[] = [];
  for (const entry of suggestions) {
    if (entry.shortcode.startsWith(q)) {
      prefix.push(entry);
      if (prefix.length >= limit) break;
    } else if (entry.shortcode.includes(q)) {
      contains.push(entry);
    }
  }
  if (prefix.length >= limit) return prefix;
  return prefix.concat(contains).slice(0, limit);
}

/** Token regex: `:` then 1+ allowed chars then `:`. Not anchored. */
export const EMOJI_SHORTCODE_RE = /:([a-z0-9_+-]+):/gi;

/** Replace every known `:shortcode:` token in `text` with its native emoji. */
export function replaceEmojiShortcodes(text: string): string {
  if (!text || !text.includes(":")) return text;
  return text.replace(EMOJI_SHORTCODE_RE, (full, code: string) => {
    const native = shortcodeToNative(code);
    return native ?? full;
  });
}

/** Cheap check used to gate the more expensive editor walk. */
export function hasEmojiShortcode(text: string): boolean {
  if (!text || !text.includes(":")) return false;
  EMOJI_SHORTCODE_RE.lastIndex = 0;
  return EMOJI_SHORTCODE_RE.test(text);
}

/**
 * Walk every text node in the editor, replacing `:shortcode:` tokens
 * with their native emoji in-place. Returns whether anything changed.
 *
 * Safe to call from `OnChangePlugin` because subsequent invocations
 * find no remaining shortcodes (idempotent).
 */
export function replaceShortcodesInEditor(editor: LexicalEditor): boolean {
  let changed = false;
  editor.update(() => {
    const nodes = $getRoot().getAllTextNodes();
    for (const node of nodes) {
      if (!$isTextNode(node)) continue;
      const text = node.getTextContent();
      if (!text.includes(":")) continue;
      const next = replaceEmojiShortcodes(text);
      if (next !== text) {
        node.setTextContent(next);
        changed = true;
      }
    }
  });
  return changed;
}
