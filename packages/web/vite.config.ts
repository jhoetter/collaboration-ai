import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig, loadEnv } from "vite";

/**
 * Available design-system presets. Each maps to
 * `src/design-systems/{id}.css` and is selected at build time via
 * `VITE_DESIGN_SYSTEM`. Mirrors the hof-os model: visual language is
 * a deployment-time decision, not a runtime one. Light/dark within a
 * preset is a separate runtime toggle (see lib/theme/colorScheme.ts).
 */
const DESIGN_SYSTEM_IDS = ["default", "playful", "conservative"] as const;
type DesignSystemId = (typeof DESIGN_SYSTEM_IDS)[number];

function resolveDesignSystemId(env: Record<string, string>): DesignSystemId {
  const raw = (
    env.VITE_DESIGN_SYSTEM ??
    env.DESIGN_SYSTEM ??
    process.env.VITE_DESIGN_SYSTEM ??
    process.env.DESIGN_SYSTEM ??
    "default"
  )
    .trim()
    .toLowerCase();
  if ((DESIGN_SYSTEM_IDS as readonly string[]).includes(raw)) {
    return raw as DesignSystemId;
  }
  console.warn(
    `[collaboration-ai] Unknown VITE_DESIGN_SYSTEM="${raw}". ` +
      `Falling back to "default". Known: ${DESIGN_SYSTEM_IDS.join(", ")}.`
  );
  return "default";
}

/**
 * Port allocation across the local "AI suite":
 *   3000 — hof-os
 *   3100 — office-ai
 *   3200 — mail-ai (reserved)
 *   3300 — collaboration-ai  ← us
 *
 * Backend FastAPI runs on 8300 to mirror the same convention
 * (8000 = hof-os, 8100 = office-ai, 8300 = collabai).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const designSystem = resolveDesignSystemId(env);
  const designSystemPath = path.resolve(__dirname, `src/design-systems/${designSystem}.css`);

  return {
    plugins: [react()],
    resolve: {
      alias: {
        "@collabai-design-system.css": designSystemPath,
      },
    },
    define: {
      __COLLAB_DESIGN_SYSTEM__: JSON.stringify(designSystem),
    },
    server: {
      host: "127.0.0.1",
      port: 3300,
      strictPort: true,
      proxy: {
        "/api": "http://127.0.0.1:8300",
        "/ws": { target: "ws://127.0.0.1:8300", ws: true },
      },
    },
    preview: {
      port: 3300,
      strictPort: true,
    },
  };
});
