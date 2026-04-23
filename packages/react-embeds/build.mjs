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
  "src/components/AttachmentViewer.tsx",
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
  // @officeai/react-editors is host-provided (the hof-os data-app
  // dedupes a single copy across editor + chat + mail embeds; standalone
  // collab-ai's web app installs it directly). Externalizing it keeps
  // the bundle small and avoids a duplicate-React/duplicate-Yjs trap.
  external: [
    "react",
    "react-dom",
    "react/jsx-runtime",
    "@officeai/react-editors",
    "@officeai/react-editors/*",
  ],
  loader: { ".css": "copy" },
  logLevel: "info",
});
console.log("react-embeds: built");
