// Ambient type stubs for `@officeai/react-editors`.
//
// See the matching file in `~/repos/mail-ai/packages/react-app/src/`
// for the rationale — the package isn't on npm, it ships as a tarball
// staged by `scripts/ensure-officeai-react-editors.cjs`, and the
// dynamic imports in `AttachmentViewer.tsx` already handle missing
// modules at runtime via try/catch.

interface OfficeEditorProps {
  url: string;
  readOnly?: boolean;
  [key: string]: unknown;
}

declare module "@officeai/react-editors/components/pdf" {
  import type { ComponentType } from "react";
  export const PdfEditor: ComponentType<OfficeEditorProps>;
}

declare module "@officeai/react-editors/components/docx" {
  import type { ComponentType } from "react";
  export const DocxEditor: ComponentType<OfficeEditorProps>;
}

declare module "@officeai/react-editors/components/xlsx" {
  import type { ComponentType } from "react";
  export const XlsxEditor: ComponentType<OfficeEditorProps>;
}

declare module "@officeai/react-editors/components/pptx" {
  import type { ComponentType } from "react";
  export const PptxEditor: ComponentType<OfficeEditorProps>;
}
