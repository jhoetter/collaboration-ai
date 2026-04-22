/**
 * Vitest configuration for the web package.
 *
 * Uses `jsdom` so component tests can mount React + Lexical, and
 * limits matched files to the `*.test.{ts,tsx}` files we author so
 * Playwright e2e specs (`.spec.ts`) are excluded.
 */
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
    exclude: ["node_modules", "dist", "tests/**"],
  },
});
