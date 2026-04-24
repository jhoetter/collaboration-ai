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
 *   handles it natively in `@collabai/web`'s standalone build. The
 *   esbuild bundle for `@collabai/react-embeds` (which transitively
 *   inlines this file via `ThreadPane`) registers a small
 *   `urlImportPlugin` in its `build.mjs` that mirrors the same
 *   semantics — emitting the worker as a sibling asset of each chunk
 *   and resolving the URL against `import.meta.url` at runtime. That
 *   keeps the embed offline-capable: no CDN fallback, no host-side
 *   global override required.
 */
import type * as pdfjsType from "pdfjs-dist";

let pdfjsHandle: Promise<typeof pdfjsType> | null = null;

export function ensurePdfjsWorker(): Promise<typeof pdfjsType> {
  if (!pdfjsHandle) {
    pdfjsHandle = (async () => {
      const [pdfjs, workerMod] = await Promise.all([
        import("pdfjs-dist"),
        import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
      ]);
      pdfjs.GlobalWorkerOptions.workerSrc = workerMod.default;
      return pdfjs;
    })();
  }
  return pdfjsHandle;
}
