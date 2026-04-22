/**
 * Shared Lexical configuration for the chat composer.
 *
 * The theme classes hook into Tailwind utility names; we keep them small
 * and stable so the editor's WYSIWYG output visually matches what
 * `MessageList` renders for sent messages.
 */
import { CodeHighlightNode, CodeNode } from "@lexical/code";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import type { InitialConfigType } from "@lexical/react/LexicalComposer";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";

const theme = {
  paragraph: "m-0",
  text: {
    bold: "font-semibold",
    italic: "italic",
    strikethrough: "line-through",
    underline: "underline",
    code:
      "rounded bg-hover px-1 py-0.5 font-mono text-[0.85em] text-foreground",
  },
  heading: {
    h1: "text-base font-semibold text-foreground",
    h2: "text-sm font-semibold text-foreground",
    h3: "text-sm font-medium text-foreground",
  },
  list: {
    ul: "list-disc pl-5",
    ol: "list-decimal pl-5",
    listitem: "my-0",
  },
  quote: "border-l-2 border-border pl-3 text-muted-foreground",
  link: "text-accent underline decoration-accent/40 hover:decoration-accent",
  code:
    "block rounded bg-hover px-3 py-2 font-mono text-[0.85em] text-foreground overflow-x-auto",
};

export function buildEditorConfig(namespace: string): InitialConfigType {
  return {
    namespace,
    theme,
    onError: (error) => {
      console.error("Lexical error", error);
    },
    nodes: [
      HeadingNode,
      QuoteNode,
      ListNode,
      ListItemNode,
      LinkNode,
      CodeNode,
      CodeHighlightNode,
    ],
  };
}
