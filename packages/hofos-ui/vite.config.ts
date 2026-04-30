import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const singletonExternals = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];
const DESIGN_SYSTEM_IDS = ["default", "playful", "conservative"] as const;

function resolveDesignSystemId(): (typeof DESIGN_SYSTEM_IDS)[number] {
  const raw = (process.env.VITE_DESIGN_SYSTEM ?? process.env.DESIGN_SYSTEM ?? "default")
    .trim()
    .toLowerCase();
  return (DESIGN_SYSTEM_IDS as readonly string[]).includes(raw)
    ? (raw as (typeof DESIGN_SYSTEM_IDS)[number])
    : "default";
}

function external(id: string): boolean {
  return singletonExternals.includes(id) || id.startsWith("@officeai/react-editors");
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "../web/src"),
      "@collabai-design-system.css": path.resolve(
        here,
        `../web/src/design-systems/${resolveDesignSystemId()}.css`,
      ),
    },
  },
  define: {
    __COLLAB_DESIGN_SYSTEM__: JSON.stringify(resolveDesignSystemId()),
  },
  build: {
    cssCodeSplit: true,
    emptyOutDir: true,
    lib: {
      entry: "src/index.ts",
      formats: ["es"],
      fileName: "index",
    },
    outDir: "dist",
    rollupOptions: {
      external,
      output: {
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "[name][extname]",
      },
    },
    sourcemap: false,
  },
});
