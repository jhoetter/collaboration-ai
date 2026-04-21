import { collabAIPreset } from "@collabai/design-tokens/tailwind-preset";
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  presets: [collabAIPreset],
} satisfies Config;
