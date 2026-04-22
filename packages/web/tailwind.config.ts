import { collabAIPreset } from "@collabai/design-tokens/tailwind-preset";
import type { Config } from "tailwindcss";

export default {
  content: [
    "./index.html",
    "./src/**/*.{ts,tsx}",
    // `@collabai/ui` is compiled into the app but lives outside `src/`;
    // including it avoids purging classes that only appear in shared primitives.
    "../ui/src/**/*.{ts,tsx}",
  ],
  presets: [collabAIPreset],
} satisfies Config;
