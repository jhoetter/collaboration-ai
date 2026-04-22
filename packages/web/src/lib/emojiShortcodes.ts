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

let lookup: Map<string, string> | null = null;

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

/** Returns the native emoji for a shortcode (without the colons), or null. */
export function shortcodeToNative(code: string): string | null {
  if (!code) return null;
  if (!lookup) lookup = buildLookup();
  return lookup.get(code.toLowerCase()) ?? null;
}

/** Token regex: `:` then 1+ allowed chars then `:`. Not anchored. */
export const EMOJI_SHORTCODE_RE = /:([a-z0-9_+\-]+):/gi;

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
