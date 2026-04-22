/**
 * Attachment card v2.
 *
 * - Image MIME -> rounded thumbnail (max 320px tall) that opens in the
 *   message-list lightbox via the `onOpenImage` callback.
 * - PDF       -> first-page render via lazy-loaded pdfjs-dist with a
 *   filename + page count overlay; click opens an in-app PDF viewer.
 * - Link      -> OpenGraph card (title, description, image, site name).
 * - Other     -> rich card with `FileTypeIcon`, filename, byte count,
 *   and a Download button.
 *
 * Presigned download URLs are fetched lazily through
 * `attachment:download-url` on first paint.
 */
import { IconDownload, IconExternal } from "@collabai/ui";
import { useEffect, useRef, useState } from "react";
import { callFunction } from "../lib/api.ts";
import { useTranslator } from "../lib/i18n/index.ts";
import type { Attachment } from "../state/sync.ts";
import { FileTypeIcon } from "./FileTypeIcon.tsx";
import { PdfViewer } from "./PdfViewer.tsx";

export interface AttachmentCardProps {
  attachment: Attachment;
  /** Triggered when the user clicks an image — used for the lightbox. */
  onOpenImage?: (attachment: Attachment) => void;
}

export function AttachmentCard({ attachment, onOpenImage }: AttachmentCardProps) {
  const { t } = useTranslator();
  const isImage = attachment.mime.startsWith("image/");
  const isPdf = attachment.mime === "application/pdf";
  const isLinkPreview =
    (attachment as Attachment & { kind?: string }).kind === "link_preview";
  const url = useDownloadUrl(attachment, isLinkPreview);
  const [pdfOpen, setPdfOpen] = useState(false);

  if (isLinkPreview) {
    return <LinkPreviewCard attachment={attachment} />;
  }

  if (isImage) {
    if (!url) {
      return (
        <div
          className="flex items-center justify-center rounded-md border border-border bg-card text-xs text-tertiary"
          style={{ width: 240, height: 160 }}
        >
          …
        </div>
      );
    }
    return (
      <button
        type="button"
        onClick={() => onOpenImage?.(attachment)}
        className="block overflow-hidden rounded-md border border-border bg-card transition-shadow hover:shadow-md"
      >
        <img
          src={url}
          alt={attachment.name}
          className="max-h-80 max-w-sm object-cover"
          loading="lazy"
        />
      </button>
    );
  }

  if (isPdf) {
    return (
      <>
        <button
          type="button"
          onClick={() => setPdfOpen(true)}
          className="group flex w-full max-w-[18rem] items-stretch overflow-hidden rounded-md border border-border bg-card text-left transition-shadow hover:shadow-md sm:w-72"
        >
          <PdfThumb url={url} />
          <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 p-2.5 text-xs">
            <div className="min-w-0">
              <p className="truncate font-medium text-foreground">{attachment.name}</p>
              <p className="text-tertiary">
                PDF · {formatBytes(attachment.size_bytes)}
              </p>
            </div>
            <span className="inline-flex items-center gap-1 text-accent opacity-0 transition-opacity group-hover:opacity-100">
              <IconExternal size={12} />
              {t("common.open")}
            </span>
          </div>
        </button>
        {pdfOpen && url && (
          <PdfViewer url={url} name={attachment.name} onClose={() => setPdfOpen(false)} />
        )}
      </>
    );
  }

  return (
    <div className="flex w-full max-w-[18rem] items-center gap-3 rounded-md border border-border bg-card p-2.5 transition-shadow hover:shadow-md sm:w-72">
      <FileTypeIcon mime={attachment.mime} filename={attachment.name} size={40} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{attachment.name}</p>
        <p className="text-xs text-tertiary">{formatBytes(attachment.size_bytes)}</p>
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          download={attachment.name}
          aria-label={t("common.download")}
          title={t("common.download")}
          className="inline-flex h-8 w-8 flex-none items-center justify-center rounded-md text-secondary transition-colors hover:bg-hover hover:text-foreground"
        >
          <IconDownload size={14} />
        </a>
      )}
    </div>
  );
}

export function PdfThumb({ url, size = 96 }: { url: string | null; size?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!url || !canvasRef.current) return;
    let cancelled = false;
    (async () => {
      try {
        const pdfjs = await import("pdfjs-dist");
        const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
        pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
        const doc = await pdfjs.getDocument({ url }).promise;
        const page = await doc.getPage(1);
        if (cancelled) return;
        const viewport = page.getViewport({ scale: 1 });
        const canvas = canvasRef.current;
        if (!canvas) return;
        const scale = size / viewport.width;
        const scaled = page.getViewport({ scale });
        canvas.width = Math.ceil(scaled.width);
        canvas.height = Math.ceil(scaled.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        await page.render({ canvas, canvasContext: ctx, viewport: scaled }).promise;
      } catch (err) {
        console.warn("pdf preview failed", err);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [url, size]);
  return (
    <div
      className="flex flex-none items-center justify-center bg-background"
      style={{ width: size, height: size }}
    >
      {error || !url ? (
        <FileTypeIcon mime="application/pdf" filename=".pdf" size={Math.round(size / 2)} />
      ) : (
        <canvas ref={canvasRef} className="max-h-full max-w-full" />
      )}
    </div>
  );
}

function LinkPreviewCard({ attachment }: { attachment: Attachment }) {
  const meta = (attachment as Attachment & {
    title?: string;
    description?: string;
    site_name?: string;
    image_url?: string;
    url?: string;
  });
  return (
    <a
      href={meta.url ?? "#"}
      target="_blank"
      rel="noreferrer"
      className="flex w-96 max-w-full overflow-hidden rounded-md border border-border bg-card transition-shadow hover:shadow-md"
    >
      <span className="w-1 shrink-0 bg-accent" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1 p-3 text-xs">
        {meta.site_name && (
          <span className="text-tertiary">{meta.site_name}</span>
        )}
        {meta.title && (
          <span className="text-sm font-medium text-foreground">{meta.title}</span>
        )}
        {meta.description && (
          <span className="line-clamp-2 text-secondary">{meta.description}</span>
        )}
      </div>
      {meta.image_url && (
        <img
          src={meta.image_url}
          alt={meta.title ?? ""}
          className="hidden max-h-24 w-32 flex-none object-cover sm:block"
          loading="lazy"
        />
      )}
    </a>
  );
}

function useDownloadUrl(attachment: Attachment, skip: boolean): string | null {
  const [url, setUrl] = useState<string | null>(attachment.thumbnail_url ?? null);
  useEffect(() => {
    if (skip) return;
    if (url) return;
    let cancelled = false;
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
  }, [attachment.file_id, url, skip]);
  return url;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}
