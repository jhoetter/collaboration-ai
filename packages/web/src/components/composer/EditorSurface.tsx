/**
 * Lexical-backed editable surface for the chat composer.
 *
 * Wraps the bits we need: rich text, history, lists, links, markdown
 * shortcuts (so typing `**foo**` instantly bolds), and a clear-editor
 * command. Keyboard handling for Enter / Esc / arrow nav is delegated
 * to the parent through the `onKeyDownCapture` prop because we need
 * to coordinate with mention / slash popovers that live outside the
 * editor tree.
 *
 * Layout note: padding lives on the ContentEditable and the
 * placeholder uses `inset-0` with the same padding. That keeps the
 * placeholder text and the empty paragraph's caret on the exact same
 * line-box so they overlap pixel-perfectly. Putting padding on the
 * outer wrapper while the placeholder uses `top-x` from the padding
 * edge introduces a sub-pixel/line-height drift that reads as a
 * visible "extra newline" above the placeholder when the editor is
 * empty.
 */
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { AutoLinkPlugin } from "@lexical/react/LexicalAutoLinkPlugin";
import { ClearEditorPlugin } from "@lexical/react/LexicalClearEditorPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LinkPlugin } from "@lexical/react/LexicalLinkPlugin";
import { ListPlugin } from "@lexical/react/LexicalListPlugin";
import { MarkdownShortcutPlugin } from "@lexical/react/LexicalMarkdownShortcutPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { RichTextPlugin } from "@lexical/react/LexicalRichTextPlugin";
import { TRANSFORMERS } from "@lexical/markdown";
import type { LexicalEditor } from "lexical";

import { AUTO_LINK_MATCHERS } from "./autoLinkMatchers.ts";

interface EditorSurfaceProps {
  ariaLabel: string;
  placeholder: React.ReactNode;
  onChange: (editor: LexicalEditor) => void;
  onKeyDownCapture: (e: React.KeyboardEvent<HTMLDivElement>) => void;
  onPaste: (e: React.ClipboardEvent<HTMLDivElement>) => void;
}

export function EditorSurface({
  ariaLabel,
  placeholder,
  onChange,
  onKeyDownCapture,
  onPaste,
}: EditorSurfaceProps) {
  return (
    <div className="relative" onKeyDownCapture={onKeyDownCapture} onPaste={onPaste}>
      <RichTextPlugin
        contentEditable={
          <ContentEditable
            aria-label={ariaLabel}
            aria-placeholder={typeof placeholder === "string" ? placeholder : ""}
            placeholder={
              <div className="pointer-events-none absolute inset-0 select-none px-4 py-2.5 text-[15px] leading-relaxed text-tertiary">
                {placeholder}
              </div>
            }
            className="block max-h-48 min-h-[2.625rem] overflow-y-auto whitespace-pre-wrap break-words px-4 py-2.5 text-[15px] leading-relaxed text-foreground outline-none"
          />
        }
        ErrorBoundary={LexicalErrorBoundary}
      />
      <HistoryPlugin />
      <ListPlugin />
      <LinkPlugin />
      <AutoLinkPlugin matchers={AUTO_LINK_MATCHERS} />
      <MarkdownShortcutPlugin transformers={TRANSFORMERS} />
      <ClearEditorPlugin />
      <OnChangePlugin ignoreSelectionChange onChange={(_state, editor) => onChange(editor)} />
    </div>
  );
}
