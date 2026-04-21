import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
export default defineConfig({
  plugins: [react()],
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
});
