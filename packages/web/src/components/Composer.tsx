import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { $getRoot, type EditorState } from "lexical";
import { useRef, useState } from "react";
import { Button } from "@collabai/ui";

export interface ComposerProps {
  onSend: (text: string) => void | Promise<void>;
}

const initialConfig = {
  namespace: "collab-composer",
  theme: { paragraph: "text-sm text-slate-100" },
  onError: (e: Error) => {
    console.error("[lexical]", e);
  },
};

export function Composer({ onSend }: ComposerProps) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  function handleChange(state: EditorState) {
    state.read(() => {
      setText($getRoot().getTextContent());
    });
  }

  async function handleSend() {
    const trimmed = text.trim();
    if (!trimmed) return;
    await onSend(trimmed);
    setText("");
    ref.current?.focus();
  }

  return (
    <div className="border-t border-slate-800 bg-slate-900 p-2">
      <LexicalComposer initialConfig={initialConfig}>
        <div className="rounded border border-slate-700 bg-slate-800 px-3 py-2">
          <PlainTextPlugin
            contentEditable={
              <ContentEditable
                ref={ref}
                aria-label="Message composer"
                className="min-h-[40px] outline-none"
              />
            }
            placeholder={
              <div className="pointer-events-none -mt-[40px] text-sm text-slate-500">
                Send a message
              </div>
            }
            ErrorBoundary={LexicalErrorBoundary}
          />
          <HistoryPlugin />
          <OnChangePlugin onChange={handleChange} />
        </div>
        <div className="mt-2 flex justify-end">
          <Button variant="primary" size="sm" onClick={handleSend} disabled={!text.trim()}>
            Send
          </Button>
        </div>
      </LexicalComposer>
    </div>
  );
}
