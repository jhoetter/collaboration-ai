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
  logLevel: "info",
});
console.log("react-embeds: built");
