/**
 * Thin wrapper around `emoji-mart` for the composer + reaction picker.
 *
 * `emoji-mart` ships its own picker + (8MB) data bundle. We use the
 * `Picker` component directly with the Slack-style "search → grid" UX
 * and a minimal dark theme.
 */
import data from "@emoji-mart/data";
import Picker from "@emoji-mart/react";
import { useEffect, useRef } from "react";

export interface EmojiPickerProps {
  onPick: (emoji: string) => void;
  onClose: () => void;
}

export function EmojiPicker({ onPick, onClose }: EmojiPickerProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleDocClick(e: MouseEvent) {
      if (!ref.current) return;
      if (!ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleDocClick);
    return () => document.removeEventListener("mousedown", handleDocClick);
  }, [onClose]);

  return (
    <div ref={ref} className="rounded border border-slate-700 bg-slate-900 shadow-2xl">
      <Picker
        data={data}
        theme="dark"
        previewPosition="none"
        skinTonePosition="none"
        onEmojiSelect={(emoji: { native?: string; shortcodes?: string }) => {
          onPick(emoji.native ?? emoji.shortcodes ?? "");
        }}
      />
    </div>
  );
}
