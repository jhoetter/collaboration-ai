/**
 * Bare-domain auto-linking.
 *
 * `remark-gfm`'s autolink-literal extension only recognises URLs with
 * a scheme (`https://example.com`) or the `www.` prefix. Users who
 * paste plain domains like `hpi.de` or `example.org/about` get raw
 * text instead of a clickable link.
 *
 * This module ships:
 *
 *   - `findBareLinks(text)`: scans a string for `host[.tld][/path]`
 *     occurrences whose TLD is in a curated allowlist. Used by the
 *     composer to spawn `link:unfurl` previews for bare domains so the
 *     OpenGraph card matches what gets rendered.
 *
 *   - `remarkAutolinkBareDomains()`: a tiny remark plugin (no extra
 *     dependency) that walks the markdown AST, replaces matching
 *     substrings inside `text` nodes with `link` nodes, and skips
 *     children of `link` / `linkReference` / `code` / `inlineCode` so
 *     existing links and code spans are left alone.
 *
 * The TLD allowlist is intentionally small. We only auto-link the
 * gTLDs and ccTLDs that are realistic in a chat (and avoid common
 * file-extension look-alikes like `.md`, `.py`, `.rs`, `.ts` so file
 * names dropped into prose are not turned into hyperlinks).
 */

const TLDS = new Set<string>([
  // Generic
  "com", "org", "net", "edu", "gov", "mil", "int",
  "info", "biz", "name", "pro", "xyz",
  "online", "store", "shop", "blog", "page", "site",
  "tech", "cloud", "design", "agency", "studio",
  "news", "software", "app", "dev",
  "ai", "io", "co", "me", "tv", "fm",
  // Europe (frequent in chat)
  "de", "at", "ch", "uk", "ie", "fr", "be", "nl", "lu",
  "es", "pt", "it", "se", "no", "dk", "fi", "is",
  "cz", "sk", "hu", "ro", "bg", "hr", "si",
  "ee", "lv", "lt", "ru", "ua", "tr", "gr",
  // Americas
  "us", "ca", "mx", "br", "ar", "cl", "pe",
  // Asia / Pacific
  "jp", "cn", "kr", "tw", "hk", "sg", "in", "id", "th", "vn",
  "au", "nz",
  // Africa
  "za", "ng", "ke", "eg", "ma",
  // Supranational
  "eu",
]);

// `(?<![@\w/?:.])` keeps us out of:
//   - emails / mentions   (`user@hpi.de`,  `@alex.dev`)
//   - file paths / URLs   (`./foo.de`, `://hpi.de`, `?q=hpi.de`)
//   - dotted identifiers  (`foo.bar.de` is fine, but `1.2.3.de` is not
//     — we still match the labels but the lookbehind for `.` blocks
//     extending into a longer chain that already started)
//
// Each label is `[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?` (RFC-ish), at
// least one `label.` repetition, then a TLD of 2–24 letters. The
// optional path is anything that isn't whitespace or one of the
// "obviously closing" punctuation marks; trailing punctuation
// (`).,;:!?`) is trimmed afterwards.
const PATTERN =
  /(?<![@\w/?:.])((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(\/[^\s<>"'`]*)?/gi;

const TRAILING_PUNCT = /[)\].,;:!?"']+$/;

export interface BareLinkMatch {
  /** Inclusive start offset in the source text. */
  start: number;
  /** Exclusive end offset in the source text (after trailing-punct trim). */
  end: number;
  /** Domain portion only, e.g. `hpi.de`. */
  host: string;
  /** Path portion (with leading `/`) or empty string. */
  path: string;
  /** Canonical absolute URL — always `https://`. */
  url: string;
  /** Exact substring (host + trimmed path) as it appears in source. */
  text: string;
}

/** Scan `text` for bare-domain references. Pure, regex-only. */
export function findBareLinks(text: string): BareLinkMatch[] {
  const out: BareLinkMatch[] = [];
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(text)) !== null) {
    const host = m[1];
    const rawPath = m[2] ?? "";
    const tld = host.slice(host.lastIndexOf(".") + 1).toLowerCase();
    if (!TLDS.has(tld)) continue;

    // Strip trailing punctuation that almost certainly belongs to the
    // surrounding sentence, not the link. We do it *after* the regex
    // so balanced characters inside paths (`/foo(bar)`) survive.
    const trimmedPath = rawPath.replace(TRAILING_PUNCT, "");
    const fullText = `${host}${trimmedPath}`;

    out.push({
      start: m.index,
      end: m.index + fullText.length,
      host,
      path: trimmedPath,
      url: `https://${host}${trimmedPath}`,
      text: fullText,
    });
  }
  return out;
}

// ---- remark plugin ---------------------------------------------------

interface MdNode {
  type: string;
  value?: unknown;
  children?: MdNode[];
}

interface MdText {
  type: "text";
  value: string;
}

interface MdLink {
  type: "link";
  url: string;
  title: null;
  children: MdText[];
}

const SKIP_PARENTS = new Set(["link", "linkReference", "code", "inlineCode"]);

/**
 * Remark plugin: replace bare-domain occurrences in `text` nodes with
 * `link` nodes. Safe to use alongside `remark-gfm` — we ignore text
 * already inside a link or code span.
 */
export function remarkAutolinkBareDomains() {
  return (tree: MdNode): void => {
    walk(tree);
  };
}

function walk(node: MdNode): void {
  if (!node.children) return;
  if (SKIP_PARENTS.has(node.type)) return;
  for (let i = 0; i < node.children.length; i++) {
    const child = node.children[i];
    if (child.type === "text" && typeof child.value === "string") {
      const replaced = expand(child.value);
      if (replaced) {
        node.children.splice(i, 1, ...replaced);
        i += replaced.length - 1;
      }
    } else {
      walk(child);
    }
  }
}

function expand(text: string): (MdText | MdLink)[] | null {
  const matches = findBareLinks(text);
  if (matches.length === 0) return null;
  const out: (MdText | MdLink)[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      out.push({ type: "text", value: text.slice(cursor, m.start) });
    }
    out.push({
      type: "link",
      url: m.url,
      title: null,
      children: [{ type: "text", value: m.text }],
    });
    cursor = m.end;
  }
  if (cursor < text.length) {
    out.push({ type: "text", value: text.slice(cursor) });
  }
  return out;
}
