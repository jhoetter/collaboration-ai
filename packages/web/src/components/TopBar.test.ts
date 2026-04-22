/**
 * Pure parser tests for the workspace top bar.
 * Covers the chip extraction logic — no DOM needed.
 */
import { describe, expect, it } from "vitest";
import { parseQuery } from "./TopBar.tsx";

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
