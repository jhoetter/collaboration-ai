/**
 * Matcher definitions for Lexical's `AutoLinkPlugin`.
 *
 * Two matchers are exported:
 *
 *   - `httpMatcher`     — fully qualified `https?://…` URLs.
 *   - `bareMatcher`     — bare domains (e.g. `hpi.de`, `example.com/about`),
 *                         using the same TLD allowlist that drives chat-side
 *                         rendering so what the composer auto-links is
 *                         exactly what the message will render as.
 *
 * Together they mirror Slack's editor: as soon as the URL gains a trailing
 * boundary (space, punctuation, newline) Lexical wraps it in an
 * `AutoLinkNode`. If the user keeps deleting characters the URL stops
 * matching and Lexical unwraps it back to plain text — the "press
 * backspace to undo the auto-link" behaviour the user expects.
 */
import type { LinkMatcher } from "@lexical/react/LexicalAutoLinkPlugin";
import { createLinkMatcherWithRegExp } from "@lexical/react/LexicalAutoLinkPlugin";

import { findBareLinks } from "../../lib/autolink.ts";

// Match within a single text node; do NOT use the global `/g` flag here
// because the AutoLinkPlugin only consumes the first match per pass.
const HTTP_URL_RE = /https?:\/\/[^\s<>"]+/i;

export const httpMatcher: LinkMatcher = createLinkMatcherWithRegExp(HTTP_URL_RE, (url) => url);

export const bareMatcher: LinkMatcher = (text) => {
  const matches = findBareLinks(text);
  if (matches.length === 0) return null;
  // Take the first match only; AutoLinkPlugin will re-run after wrapping
  // so subsequent matches in the same node get picked up next pass.
  const m = matches[0];
  return {
    index: m.start,
    length: m.end - m.start,
    text: m.text,
    url: m.url,
  };
};

export const AUTO_LINK_MATCHERS: LinkMatcher[] = [httpMatcher, bareMatcher];
