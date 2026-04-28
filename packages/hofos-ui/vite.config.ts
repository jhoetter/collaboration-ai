import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const singletonExternals = ["react", "react-dom", "react-dom/client", "react/jsx-runtime"];

function external(id: string): boolean {
  return singletonExternals.includes(id) || id.startsWith("@officeai/react-editors");
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(here, "../web/src"),
      "@collabai-design-system.css": path.resolve(here, "../web/src/design-systems/default.css"),
    },
  },
  define: {
    __COLLAB_DESIGN_SYSTEM__: JSON.stringify("default"),
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
