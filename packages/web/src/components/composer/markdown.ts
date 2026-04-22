/**
 * Markdown <-> Lexical state helpers.
 *
 * The chat protocol speaks markdown end-to-end (drafts, sent messages,
 * search hits all share the same string format). We use Lexical's
 * official markdown transformers so the editor view (`<strong>`,
 * `<em>`, etc.) round-trips losslessly with what the server stores.
 */
import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
} from "@lexical/markdown";
import { $getRoot, type LexicalEditor } from "lexical";

/** Read the current editor state as canonical markdown. */
export function readMarkdown(editor: LexicalEditor): string {
  return editor.getEditorState().read(() => $convertToMarkdownString(TRANSFORMERS));
}

/** Replace the editor contents with the given markdown string. */
export function writeMarkdown(editor: LexicalEditor, markdown: string): void {
  editor.update(() => {
    const root = $getRoot();
    root.clear();
    if (markdown) {
      $convertFromMarkdownString(markdown, TRANSFORMERS);
    }
  });
}

/** Strip leading/trailing whitespace lines for the "is the editor empty" check. */
export function isMarkdownEmpty(markdown: string): boolean {
  return markdown.replace(/\s/g, "").length === 0;
}
