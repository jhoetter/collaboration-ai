/**
 * Verify that programmatically inserting a `LinkNode` into the
 * Lexical editor (the path used by Composer's link toolbar button)
 * round-trips as `[label](url)` markdown and survives both an empty
 * document and a document with existing text + collapsed caret.
 */
import { CodeNode } from "@lexical/code";
import { $createLinkNode, LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type BaseSelection,
  createEditor,
} from "lexical";
import { describe, expect, it } from "vitest";
import { readMarkdown } from "./markdown.ts";

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
  return new Promise<void>((resolve) =>
    editor.update(
      () => {
        /* no-op */
      },
      { onUpdate: () => resolve() }
    )
  );
}

describe("link insertion via insertNodes", () => {
  it("inserts a link into an empty document", async () => {
    const editor = makeEditor();
    editor.update(() => {
      const para = $createParagraphNode();
      $getRoot().append(para);
      para.select();
    });
    await flush(editor);

    editor.update(() => {
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) throw new Error("no range selection");
      const link = $createLinkNode("https://example.com");
      link.append($createTextNode("the docs"));
      sel.insertNodes([link]);
    });
    await flush(editor);

    expect(readMarkdown(editor)).toBe("[the docs](https://example.com)");
  });

  it("inserts a link at the caret inside existing text", async () => {
    const editor = makeEditor();
    let saved: BaseSelection | null = null;

    editor.update(() => {
      const para = $createParagraphNode();
      const text = $createTextNode("see  here");
      para.append(text);
      $getRoot().append(para);
      const sel = text.select(4, 4);
      saved = sel.clone();
    });
    await flush(editor);

    editor.update(() => {
      if (saved) $setSelection(saved.clone());
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) throw new Error("no range selection");
      const link = $createLinkNode("https://example.com");
      link.append($createTextNode("the docs"));
      sel.insertNodes([link]);
    });
    await flush(editor);

    expect(readMarkdown(editor)).toBe("see [the docs](https://example.com) here");
  });

  it("replaces a non-collapsed selection with the link", async () => {
    const editor = makeEditor();
    let saved: BaseSelection | null = null;

    editor.update(() => {
      const para = $createParagraphNode();
      const text = $createTextNode("see docs here");
      para.append(text);
      $getRoot().append(para);
      const sel = text.select(4, 8);
      saved = sel.clone();
    });
    await flush(editor);

    editor.update(() => {
      if (saved) $setSelection(saved.clone());
      const sel = $getSelection();
      if (!$isRangeSelection(sel)) throw new Error("no range selection");
      const link = $createLinkNode("https://example.com");
      link.append($createTextNode("the docs"));
      sel.insertNodes([link]);
    });
    await flush(editor);

    expect(readMarkdown(editor)).toBe("see [the docs](https://example.com) here");
  });
});
