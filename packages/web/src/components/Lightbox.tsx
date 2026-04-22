/**
 * Full-screen image viewer with prev/next navigation and download.
 *
 * Driven by the `useLightbox` hook so any caller can `.open(att, peers)`
 * to display an attachment plus the gallery of sibling images on the
 * same message. Keyboard: ←/→ navigate, Escape closes.
 */
import { IconArrowDown, IconChevronLeft, IconChevronRight, IconClose, IconDownload } from "@collabai/ui";
import { useCallback, useEffect, useState } from "react";
import { callFunction } from "../lib/api.ts";
import type { Attachment } from "../state/sync.ts";

export interface LightboxProps {
  entry: Attachment;
  peers: Attachment[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

export function Lightbox({ entry, peers, onClose, onPrev, onNext }: LightboxProps) {
  const url = useImageUrl(entry);
  const idx = peers.findIndex((p) => p.file_id === entry.file_id);
  const total = peers.length;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft" && total > 1) onPrev();
      else if (e.key === "ArrowRight" && total > 1) onNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, total]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{entry.name}</p>
          {total > 1 && (
            <p className="text-xs text-white/60">
              {idx + 1} / {total}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1">
          {url && (
            <a
              href={url}
              download={entry.name}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
              aria-label="Download"
            >
              <IconDownload size={16} />
            </a>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Close"
          >
            <IconClose size={16} />
          </button>
        </div>
      </div>
      <div
        className="relative flex flex-1 items-center justify-center overflow-hidden px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        {total > 1 && (
          <button
            type="button"
            onClick={onPrev}
            aria-label="Previous"
            className="absolute left-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <IconChevronLeft size={20} />
          </button>
        )}
        {url ? (
          <img
            src={url}
            alt={entry.name}
            className="max-h-full max-w-full select-none rounded-md object-contain shadow-2xl"
          />
        ) : (
          <span className="text-white/60">Loading…</span>
        )}
        {total > 1 && (
          <button
            type="button"
            onClick={onNext}
            aria-label="Next"
            className="absolute right-4 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <IconChevronRight size={20} />
          </button>
        )}
        <span className="sr-only">
          <IconArrowDown size={1} />
        </span>
      </div>
    </div>
  );
}

export interface UseLightbox {
  entry: Attachment | null;
  peers: Attachment[];
  open(entry: Attachment, peers: Attachment[]): void;
  close(): void;
  prev(): void;
  next(): void;
}

export function useLightbox(): UseLightbox {
  const [entry, setEntry] = useState<Attachment | null>(null);
  const [peers, setPeers] = useState<Attachment[]>([]);
  const open = useCallback((e: Attachment, p: Attachment[]) => {
    setEntry(e);
    setPeers(p.length > 0 ? p : [e]);
  }, []);
  const close = useCallback(() => setEntry(null), []);
  const step = useCallback(
    (delta: number) => {
      setEntry((cur) => {
        if (!cur) return cur;
        const idx = peers.findIndex((p) => p.file_id === cur.file_id);
        if (idx < 0) return cur;
        const next = (idx + delta + peers.length) % peers.length;
        return peers[next] ?? cur;
      });
    },
    [peers],
  );
  return {
    entry,
    peers,
    open,
    close,
    prev: useCallback(() => step(-1), [step]),
    next: useCallback(() => step(1), [step]),
  };
}

function useImageUrl(attachment: Attachment): string | null {
  const [url, setUrl] = useState<string | null>(attachment.thumbnail_url ?? null);
  useEffect(() => {
    let cancelled = false;
    setUrl(attachment.thumbnail_url ?? null);
    void callFunction<{ get_url: string }>("attachment:download-url", {
      file_id: attachment.file_id,
    })
      .then((res) => {
        if (!cancelled) setUrl(res.get_url);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [attachment.file_id, attachment.thumbnail_url]);
  return url;
}
