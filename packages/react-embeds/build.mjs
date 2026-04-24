// esbuild bundle for the publishable embed package.
// Mirrors mail-ai's packages/react-app/build.mjs and office-ai's
// packages/react-editors/build.mjs:
//   - inline @collabai/ui + @collabai/design-tokens (raw TS) so Vite
//     hosts (e.g. hof-os data-app) don't need workspace resolution
//   - externalize React + react/jsx-runtime so the host owns those
//     copies (single React, no duplicate module trees)
//
// Output (dist/) mirrors the package "exports" map; release tarballs
// are built via `pnpm --filter @collabai/react-embeds --prod deploy`,
// which only ships dist + src + package.json.

import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const entries = [
  "src/index.ts",
  "src/contract.ts",
  "src/commands.ts",
  "src/components/AttachmentViewer.tsx",
  "src/CollabAiApp.tsx",
  "src/AppProviders.tsx",
  "src/CollabAiChannelList.tsx",
  "src/CollabAiChannel.tsx",
  "src/CollabAiThreadPane.tsx",
  "src/CollabAiActivityPane.tsx",
  "src/CollabAiSearchInput.tsx",
];

/**
 * esbuild plugin: honour Vite's `?url` import suffix.
 *
 * Vite-native source files in `packages/web/src` (e.g. the pdfjs-dist
 * worker bootstrap shared by `PdfThumb` + `PdfViewer`) import worker
 * assets like:
 *
 *   import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
 *
 * Vite resolves the `?url` suffix to a fingerprinted asset path. Plain
 * esbuild treats the suffix as part of the path, fails to resolve, and
 * falls back to bundling the worker module's exports — which yields
 * `workerUrl === undefined` at runtime and pdfjs throws "Invalid
 * `workerSrc` type." This plugin closes the gap so the embed bundle
 * behaves identically:
 *
 *   1. Strip `?url` from the specifier and let esbuild's resolver find
 *      the underlying file (still anchored at the importer's dir, so
 *      pnpm's nested layout works).
 *   2. Replace the import with a one-line proxy that re-imports the
 *      resolved file through the `file` loader (which copies the asset
 *      into `dist/` and returns its relative path) and wraps the
 *      result in `new URL(..., import.meta.url).href` so the consumer
 *      gets a fully-qualified URL anchored at the chunk's runtime
 *      location — survives both Vite's dev server and a static-host
 *      production build.
 *
 * Entirely offline: no CDN URLs, no `globalThis.__*` host overrides
 * required. The pdfjs-dist version that ships is whatever the
 * workspace pins (currently 5.6.205 → `build/pdf.worker.min.mjs`).
 */
const urlImportPlugin = {
  name: "url-import",
  setup(pluginBuild) {
    pluginBuild.onResolve({ filter: /\?url$/ }, async (args) => {
      const cleanPath = args.path.slice(0, -"?url".length);
      const resolved = await pluginBuild.resolve(cleanPath, {
        importer: args.importer,
        resolveDir: args.resolveDir,
        kind: args.kind,
      });
      if (resolved.errors.length > 0) return { errors: resolved.errors };
      return { path: resolved.path, namespace: "url-import-wrapper" };
    });

    pluginBuild.onLoad(
      { filter: /.*/, namespace: "url-import-wrapper" },
      (args) => ({
        contents: `import asset from ${JSON.stringify(`${args.path}?url-import-asset`)};\nexport default new URL(asset, import.meta.url).href;\n`,
        loader: "js",
        resolveDir: dirname(args.path),
      }),
    );

    pluginBuild.onResolve({ filter: /\?url-import-asset$/ }, (args) => ({
      path: args.path.slice(0, -"?url-import-asset".length),
      namespace: "url-import-asset",
    }));

    pluginBuild.onLoad(
      { filter: /.*/, namespace: "url-import-asset" },
      async (args) => ({
        contents: await readFile(args.path),
        loader: "file",
        resolveDir: dirname(args.path),
      }),
    );
  },
};

await build({
  entryPoints: entries.map((e) => resolve(here, e)),
  outdir: resolve(here, "dist"),
  format: "esm",
  bundle: true,
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  sourcemap: true,
  // Break the import cycle: when we bundle the WorkspaceShell from
  // packages/web/src, two of its components (AttachmentCard +
  // AttachmentLightbox) import back into `@collabai/react-embeds`.
  // Aliasing to our own source files lets esbuild resolve those
  // imports directly without recursing into the package's compiled
  // dist (which may not yet exist on a clean build).
  alias: {
    "@collabai/react-embeds": resolve(here, "src/index.ts"),
  },
  // @officeai/react-editors is host-provided (the hof-os data-app
  // dedupes a single copy across editor + chat + mail embeds; standalone
  // collab-ai's web app installs it directly). Externalizing it keeps
  // the bundle small and avoids a duplicate-React/duplicate-Yjs trap.
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "react-router",
    "@tanstack/react-query",
    "zustand",
    "@officeai/react-editors",
    "@officeai/react-editors/*",
  ],
  loader: { ".css": "copy" },
  // Asset filenames keep the original basename so consumers can grep
  // `pdf.worker` in `dist/` to confirm the worker shipped (and to
  // reason about cache headers when self-hosting the bundle).
  assetNames: "[name]-[hash]",
  plugins: [urlImportPlugin],
  logLevel: "info",
});
console.log("react-embeds: built");
