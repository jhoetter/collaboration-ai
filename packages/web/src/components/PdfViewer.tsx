/**
 * Lightweight PDF viewer over a presigned download URL.
 *
 * Renders one page at a time onto a canvas via lazy-loaded pdfjs-dist
 * (worker also loaded on demand to keep the main bundle slim). Keyboard
 * arrows page through; Escape closes.
 */
import { IconChevronLeft, IconChevronRight, IconClose, IconDownload } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { ensurePdfjsWorker } from "../lib/pdfjs.ts";

export interface PdfViewerProps {
  url: string;
  name: string;
  onClose: () => void;
}

export function PdfViewer({ url, name, onClose }: PdfViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const docRef = useRef<unknown>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pdfjs = await ensurePdfjsWorker();
        const doc = await pdfjs.getDocument({ url }).promise;
        if (cancelled) return;
        docRef.current = doc;
        setPageCount(doc.numPages);
        setLoading(false);
      } catch (err) {
        console.warn("pdf load failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url]);

  useEffect(() => {
    const doc = docRef.current as { getPage(n: number): Promise<unknown> } | null;
    if (!doc || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const target = await doc.getPage(page);
        if (cancelled) return;
        const p = target as {
          getViewport(o: { scale: number }): { width: number; height: number };
          render(o: {
            canvas: HTMLCanvasElement;
            canvasContext: CanvasRenderingContext2D;
            viewport: { width: number; height: number };
          }): { promise: Promise<void> };
        };
        const initial = p.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const targetW = Math.min(900, window.innerWidth - 96);
        const scale = targetW / initial.width;
        const viewport = p.getViewport({ scale });
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await p.render({ canvas, canvasContext: ctx, viewport }).promise;
      } catch (err) {
        console.warn("pdf render failed", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [page, pageCount]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowLeft") setPage((p) => Math.max(1, p - 1));
      else if (e.key === "ArrowRight") setPage((p) => Math.min(pageCount, p + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pageCount]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          <p className="text-xs text-white/60">
            Page {page} / {pageCount}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <a
            href={url}
            download={name}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            aria-label="Download"
          >
            <IconDownload size={16} />
          </a>
          <button
            type="button"
            aria-label="Close"
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <IconClose size={16} />
          </button>
        </div>
      </div>
      <div
        className="relative flex flex-1 items-center justify-center overflow-auto px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        {pageCount > 1 && (
          <button
            type="button"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="absolute left-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            aria-label="Previous page"
          >
            <IconChevronLeft size={20} />
          </button>
        )}
        {loading ? (
          <span className="text-white/60">Loading…</span>
        ) : (
          <canvas ref={canvasRef} className="rounded-md bg-white shadow-2xl" />
        )}
        {pageCount > 1 && (
          <button
            type="button"
            onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            disabled={page === pageCount}
            className="absolute right-4 top-1/2 -translate-y-1/2 inline-flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            aria-label="Next page"
          >
            <IconChevronRight size={20} />
          </button>
        )}
      </div>
    </div>
  );
}
