/**
 * Modal lightbox wrapping the office-ai-backed AttachmentViewer.
 *
 * Replaces the bespoke PdfViewer (kept around as a fallback when
 * @officeai/react-editors isn't installed). Routes PDF / DOCX / XLSX /
 * PPTX through the same renderer the rest of the bithof platform
 * (hof-os edit-asset, mail-ai attachments) uses.
 */
import { IconClose, IconDownload } from "@collabai/ui";
import { useEffect } from "react";
import { AttachmentViewer } from "../lib/AttachmentViewer";
import { PdfViewer } from "./PdfViewer.tsx";

export interface AttachmentLightboxProps {
  url: string;
  name: string;
  mime: string;
  onClose: () => void;
}

export function AttachmentLightbox({ url, name, mime, onClose }: AttachmentLightboxProps) {
  if (mime === "application/pdf" || name.toLowerCase().endsWith(".pdf")) {
    return <PdfViewer url={url} name={name} onClose={onClose} />;
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex flex-col bg-black/80 backdrop-blur-sm"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 text-white">
        <p className="min-w-0 truncate text-sm font-medium">{name}</p>
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
        className="relative flex flex-1 items-stretch justify-center overflow-auto px-4 pb-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-full max-w-5xl rounded-md bg-white shadow-2xl">
          <AttachmentViewer url={url} mime={mime} filename={name} readOnly />
        </div>
      </div>
    </div>
  );
}
