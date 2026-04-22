/**
 * Tests for the `:shortcode:` → native emoji helper.
 *
 * We rely on `@emoji-mart/data` having stable ids for the canonical
 * emoji we touch here (`wave`, `heart`, `thumbsup`, `+1`). That data
 * package follows the Unicode CLDR shortcodes, so these have been
 * stable for years.
 */
import { describe, expect, it } from "vitest";
import {
  EMOJI_SHORTCODE_RE,
  hasEmojiShortcode,
  replaceEmojiShortcodes,
  shortcodeToNative,
} from "./emojiShortcodes.ts";

describe("emoji shortcodes", () => {
  it("resolves canonical shortcodes to native emoji", () => {
    expect(shortcodeToNative("wave")).toBe("👋");
    expect(shortcodeToNative("heart")).toBe("❤️");
  });

  it("resolves emoji-mart aliases too", () => {
    // `+1` is the canonical alias for `thumbsup`.
    expect(shortcodeToNative("+1")).toBe("👍");
  });

  it("is case-insensitive", () => {
    expect(shortcodeToNative("WAVE")).toBe(shortcodeToNative("wave"));
  });

  it("returns null for unknown shortcodes", () => {
    expect(shortcodeToNative("definitely-not-an-emoji")).toBeNull();
  });

  it("replaces inline tokens in a string", () => {
    expect(replaceEmojiShortcodes("hi :wave: there")).toBe("hi 👋 there");
  });

  it("leaves unknown shortcodes untouched", () => {
    expect(replaceEmojiShortcodes(":not-real:")).toBe(":not-real:");
  });

  it("does not mangle URLs that contain a colon", () => {
    const url = "see https://example.com:8080/x";
    expect(replaceEmojiShortcodes(url)).toBe(url);
  });

  it("hasEmojiShortcode is a cheap regex probe", () => {
    expect(hasEmojiShortcode("plain text")).toBe(false);
    expect(hasEmojiShortcode("hi :wave:")).toBe(true);
    expect(hasEmojiShortcode("hi :unknown:")).toBe(true); // probe only
  });

  it("EMOJI_SHORTCODE_RE matches expected token grammar", () => {
    EMOJI_SHORTCODE_RE.lastIndex = 0;
    const matches = "a :wave: b :+1: c".match(EMOJI_SHORTCODE_RE);
    expect(matches).toEqual([":wave:", ":+1:"]);
  });
});
