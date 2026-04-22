/**
 * Pure unit tests for the workspace top bar.
 *
 * Covers chip extraction, the term-highlighting helper, and the
 * localStorage-backed recent-searches helpers. Full DOM behaviour
 * (Cmd+F focus, arrow-nav, tab switching) is exercised manually /
 * via the Playwright suite — keeping this file pure unit keeps it
 * fast and avoids pulling in the full provider stack.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { highlight, loadRecents, parseQuery, rememberRecent } from "./TopBar.tsx";

describe("parseQuery", () => {
  it("returns the raw text when no chips are present", () => {
    expect(parseQuery("hello world")).toEqual({
      text: "hello world",
      channels: [],
      senders: [],
      hasFile: false,
      hasLink: false,
    });
  });

  it("extracts an in:#channel chip and strips it from text", () => {
    const r = parseQuery("budget in:#general");
    expect(r.channels).toEqual(["general"]);
    expect(r.text).toBe("budget");
  });

  it("accepts in: with or without a leading #", () => {
    expect(parseQuery("in:general").channels).toEqual(["general"]);
    expect(parseQuery("in:#general").channels).toEqual(["general"]);
  });

  it("extracts a from:@user chip", () => {
    const r = parseQuery("notes from:@alice");
    expect(r.senders).toEqual(["alice"]);
    expect(r.text).toBe("notes");
  });

  it("recognises has:file", () => {
    const r = parseQuery("invoice has:file");
    expect(r.hasFile).toBe(true);
    expect(r.text).toBe("invoice");
  });

  it("recognises has:link", () => {
    const r = parseQuery("link has:link");
    expect(r.hasLink).toBe(true);
    expect(r.text).toBe("link");
  });

  it("parses a combined query with three chips", () => {
    const r = parseQuery("in:#x from:@y has:file pdf review");
    expect(r.channels).toEqual(["x"]);
    expect(r.senders).toEqual(["y"]);
    expect(r.hasFile).toBe(true);
    expect(r.text).toBe("pdf review");
  });

  it("returns an empty text when only chips are present", () => {
    const r = parseQuery("in:#general");
    expect(r.text).toBe("");
  });

  it("collapses whitespace left over after chip removal", () => {
    const r = parseQuery("  hello   in:#x   world ");
    expect(r.text).toBe("hello world");
  });
});

describe("highlight", () => {
  it("returns the input unchanged when there are no terms", () => {
    expect(highlight("hello world", [])).toBe("hello world");
  });

  it("returns the input unchanged when the input is empty", () => {
    expect(highlight("", ["foo"])).toBe("");
  });

  it("wraps matched terms in <mark> case-insensitively", () => {
    const html = renderToStaticMarkup(<>{highlight("Hello World", ["world"])}</>);
    expect(html).toContain("<mark");
    expect(html).toContain(">World</mark>");
    expect(html).toContain("Hello ");
  });

  it("matches multiple distinct terms", () => {
    const html = renderToStaticMarkup(<>{highlight("the quick brown fox", ["quick", "fox"])}</>);
    expect(html.match(/<mark/g)?.length).toBe(2);
  });

  it("prefers the longest term when terms overlap", () => {
    const html = renderToStaticMarkup(<>{highlight("foobar", ["foo", "foobar"])}</>);
    expect(html).toContain(">foobar</mark>");
  });

  it("escapes regex metacharacters in terms", () => {
    expect(() => highlight("a.b", ["."])).not.toThrow();
    const html = renderToStaticMarkup(<>{highlight("a.b", ["."])}</>);
    expect(html).toContain(">.</mark>");
  });
});

describe("recent searches", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("returns an empty list when nothing is stored", () => {
    expect(loadRecents()).toEqual([]);
  });

  it("stores trimmed queries and exposes them most-recent first", () => {
    rememberRecent("alpha");
    rememberRecent("  beta  ");
    expect(loadRecents()).toEqual(["beta", "alpha"]);
  });

  it("ignores empty queries", () => {
    rememberRecent("");
    rememberRecent("   ");
    expect(loadRecents()).toEqual([]);
  });

  it("dedupes existing entries by promoting them to the top", () => {
    rememberRecent("alpha");
    rememberRecent("beta");
    rememberRecent("alpha");
    expect(loadRecents()).toEqual(["alpha", "beta"]);
  });

  it("caps the list at six entries", () => {
    for (const v of ["a", "b", "c", "d", "e", "f", "g"]) {
      rememberRecent(v);
    }
    expect(loadRecents()).toHaveLength(6);
    expect(loadRecents()[0]).toBe("g");
  });

  it("ignores corrupted localStorage entries", () => {
    window.localStorage.setItem("collabai.search.recent", "not-json");
    expect(loadRecents()).toEqual([]);
  });
});
