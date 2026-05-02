/**
 * Idempotent pdfjs-dist + worker bootstrap.
 *
 * Two surfaces in this package render PDFs through pdfjs:
 *
 *   - `AttachmentCard` (chat thumbnail) — first-page render at 96 px.
 *   - `PdfViewer` (lightbox) — full document, page-by-page.
 *
 * Both need `pdfjs.GlobalWorkerOptions.workerSrc` set BEFORE the first
 * `getDocument()` call, otherwise pdfjs throws "Invalid `workerSrc`
 * type." This helper does the wiring exactly once per page (a Promise
 * is cached so concurrent first-time callers share the same handle)
 * and returns the resolved pdfjs module so the call site can chain
 * `getDocument()` directly.
 *
 * Worker URL strategy:
 *
 *   The `?url` suffix is the bundler-native way to ship the worker as
 *   a static asset that resolves to a fetchable URL at runtime. Vite
 *   handles it natively in `@collabai/web`'s standalone build (the
 *   only consumer remaining after the hof-os Approach C cutover —
 *   the previous `@collabai/react-embeds` esbuild path was deleted
 *   alongside the package).
 */
import type * as pdfjsType from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let pdfjsHandle: Promise<typeof pdfjsType> | null = null;

export function ensurePdfjsWorker(): Promise<typeof pdfjsType> {
  if (!pdfjsHandle) {
    pdfjsHandle = (async () => {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
      return pdfjs;
    })();
  }
  return pdfjsHandle;
}
