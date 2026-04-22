/**
 * Translucent full-pane "drop to upload" target shown while files are
 * being dragged over the channel pane. The actual upload pipeline lives
 * inside the Composer; this overlay re-emits a `collab:files-dropped`
 * window event that the Composer listens for.
 */
import { IconPaperclip } from "@collabai/ui";

export interface DropOverlayProps {
  channelName: string;
}

export function DropOverlay({ channelName }: DropOverlayProps) {
  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center p-6">
      <div className="flex w-full max-w-md flex-col items-center gap-2 rounded-xl border-2 border-dashed border-accent bg-accent-light/95 px-6 py-10 text-center shadow-xl backdrop-blur-sm">
        <span className="rounded-full bg-card p-3 text-accent shadow-sm">
          <IconPaperclip size={20} />
        </span>
        <p className="text-sm font-semibold text-accent">Drop to upload</p>
        <p className="text-xs text-accent">to #{channelName}</p>
      </div>
    </div>
  );
}
