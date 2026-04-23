/**
 * Round-trips chat markdown through a real Lexical editor instance.
 * Demonstrates that typing `**hi**` (or any bold/italic/list/link
 * combination supported by `TRANSFORMERS`) survives both write and
 * read with no lossy mangling.
 */
import { CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import { createEditor } from "lexical";
import { describe, expect, it } from "vitest";
import { isMarkdownEmpty, readMarkdown, writeMarkdown } from "./markdown.ts";

function makeEditor() {
  return createEditor({
    namespace: "test",
    onError: (e) => {
      throw e;
    },
    nodes: [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode, CodeNode],
  });
}

function flush(editor: ReturnType<typeof createEditor>) {
  // Lexical updates run on a microtask queue; resolve a tick to settle.
  return new Promise<void>((resolve) =>
    editor.update(
      () => {
        /* no-op */
      },
      { onUpdate: () => resolve() }
    )
  );
}

describe("markdown round-trip", () => {
  it("treats whitespace-only strings as empty", () => {
    expect(isMarkdownEmpty("")).toBe(true);
    expect(isMarkdownEmpty("\n  \t")).toBe(true);
    expect(isMarkdownEmpty("hi")).toBe(false);
  });

  it("preserves bold formatting", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "**hi**");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("**hi**");
  });

  it("preserves italic + bold mixed text", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "this is *important* and **urgent**");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("this is *important* and **urgent**");
  });

  it("preserves inline code spans", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "run `pnpm install`");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("run `pnpm install`");
  });

  it("preserves an unordered list", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "- one\n- two\n- three");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("- one\n- two\n- three");
  });

  it("preserves a blockquote", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "> quoted text");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("> quoted text");
  });

  it("preserves an inline link with custom label", async () => {
    const editor = makeEditor();
    writeMarkdown(editor, "see [the docs](https://example.com)");
    await flush(editor);
    expect(readMarkdown(editor)).toBe("see [the docs](https://example.com)");
  });
});
