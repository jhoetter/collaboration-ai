// Single-source attachment viewer for the standalone collaboration-ai
// dev-harness UI. Routes PDFs and OOXML (docx/xlsx/pptx) through
// @officeai/react-editors so the same renderer is used here as in
// hof-os' /edit-asset and mail-ai attachments. Falls back to a plain
// download link for unsupported MIME types.
//
// Inlined from the deleted @collabai/react-embeds package after the
// hof-os Approach C cutover (sister-app UIs now ship natively from
// hof-components/modules/collabai). Kept here so the standalone web
// app keeps building.

import { lazy, Suspense } from "react";
import type { ComponentType } from "react";

interface OfficeEditorProps {
  url: string;
  readOnly?: boolean;
}

function OfficeEditorLoadError({ format, error }: { format: string; error: unknown }) {
  const message = error instanceof Error ? error.message : String(error);
  return (
    <div className="flex min-h-[20rem] flex-col items-center justify-center gap-3 rounded-md border border-border bg-card p-6 text-center">
      <p className="text-sm font-medium text-foreground">{format} preview unavailable</p>
      <p className="max-w-md text-xs text-secondary">
        @officeai/react-editors could not be loaded. Run the OfficeAI staging step or use the download
        action while the editor bundle is unavailable.
      </p>
      <code className="max-w-md break-all rounded bg-background px-2 py-1 text-[11px] text-tertiary">
        {message}
      </code>
    </div>
  );
}

const PdfEditor = lazy(async (): Promise<{ default: ComponentType<OfficeEditorProps> }> => {
  try {
    const mod = await import("@officeai/react-editors/components/pdf");
    return { default: mod.PdfEditor as ComponentType<OfficeEditorProps> };
  } catch (error) {
    return { default: () => <OfficeEditorLoadError format="PDF" error={error} /> };
  }
});

const DocxEditor = lazy(async (): Promise<{ default: ComponentType<OfficeEditorProps> }> => {
  try {
    const mod = await import("@officeai/react-editors/components/docx");
    return { default: mod.DocxEditor as ComponentType<OfficeEditorProps> };
  } catch (error) {
    return { default: () => <OfficeEditorLoadError format="DOCX" error={error} /> };
  }
});

const XlsxEditor = lazy(async (): Promise<{ default: ComponentType<OfficeEditorProps> }> => {
  try {
    const mod = await import("@officeai/react-editors/components/xlsx");
    return { default: mod.XlsxEditor as ComponentType<OfficeEditorProps> };
  } catch (error) {
    return { default: () => <OfficeEditorLoadError format="XLSX" error={error} /> };
  }
});

const PptxEditor = lazy(async (): Promise<{ default: ComponentType<OfficeEditorProps> }> => {
  try {
    const mod = await import("@officeai/react-editors/components/pptx");
    return { default: mod.PptxEditor as ComponentType<OfficeEditorProps> };
  } catch (error) {
    return { default: () => <OfficeEditorLoadError format="PPTX" error={error} /> };
  }
});

export type AttachmentKind = "pdf" | "docx" | "xlsx" | "pptx" | "other";

export function attachmentKindFor(mime: string, filename?: string): AttachmentKind {
  const ext = (filename ?? "").toLowerCase().split(".").pop() ?? "";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || ext === "docx")
    return "docx";
  if (mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" || ext === "xlsx")
    return "xlsx";
  if (mime === "application/vnd.openxmlformats-officedocument.presentationml.presentation" || ext === "pptx")
    return "pptx";
  return "other";
}

export interface AttachmentViewerProps {
  readonly url: string;
  readonly mime: string;
  readonly filename: string;
  readonly readOnly?: boolean;
}

export function AttachmentViewer(props: AttachmentViewerProps) {
  const kind = attachmentKindFor(props.mime, props.filename);
  return (
    <Suspense fallback={<div className="min-h-[20rem] p-6 text-sm text-secondary">Loading preview...</div>}>
      {kind === "pdf" && <PdfEditor url={props.url} readOnly={props.readOnly ?? true} />}
      {kind === "docx" && <DocxEditor url={props.url} readOnly={props.readOnly ?? true} />}
      {kind === "xlsx" && <XlsxEditor url={props.url} readOnly={props.readOnly ?? true} />}
      {kind === "pptx" && <PptxEditor url={props.url} readOnly={props.readOnly ?? true} />}
      {kind === "other" && (
        <a
          href={props.url}
          target="_blank"
          rel="noreferrer"
          download={props.filename}
          className="text-accent underline"
        >
          {props.filename}
        </a>
      )}
    </Suspense>
  );
}
