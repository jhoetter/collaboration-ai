// Single-source attachment viewer for the @collabai/react-embeds
// surface. Routes PDFs and OOXML (docx/xlsx/pptx) through
// @officeai/react-editors so the same renderer is used here as in
// hof-os' /edit-asset and mail-ai attachments. Falls back to a plain
// download link for unsupported MIME types.
//
// @officeai/react-editors is an OPTIONAL peer dep — the embed can be
// dropped into a host that hasn't installed the editors and the
// viewer simply degrades to "download" affordances.

import { lazy, Suspense } from "react";

const PdfEditor = lazy(async () => {
  try {
    const mod = await import("@officeai/react-editors/components/pdf");
    return { default: mod.PdfEditor };
  } catch {
    return { default: () => null };
  }
});

const DocxEditor = lazy(async () => {
  try {
    const mod = await import("@officeai/react-editors/components/docx");
    return { default: mod.DocxEditor };
  } catch {
    return { default: () => null };
  }
});

const XlsxEditor = lazy(async () => {
  try {
    const mod = await import("@officeai/react-editors/components/xlsx");
    return { default: mod.XlsxEditor };
  } catch {
    return { default: () => null };
  }
});

const PptxEditor = lazy(async () => {
  try {
    const mod = await import("@officeai/react-editors/components/pptx");
    return { default: mod.PptxEditor };
  } catch {
    return { default: () => null };
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
    <Suspense fallback={null}>
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
