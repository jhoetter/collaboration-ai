/**
 * Tailwind v3 preset for collaboration-ai.
 *
 * Every token is sourced from a CSS custom property defined by the
 * active design-system preset (see `packages/web/src/design-systems/`).
 * That keeps Tailwind utilities like `bg-background`, `text-accent`,
 * `border-border`, `rounded-md`, `font-sans` semantic — they swap when
 * the preset (or light/dark) changes without any component edits.
 *
 * No hex constants live here on purpose: anything that needs to vary
 * by preset must come from `var(--…)`. The hex values in
 * `./colors.ts` remain only as a documentation reference for preset
 * authors.
 */
import plugin from "tailwindcss/plugin";

export const collabAIPreset = {
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        surface: "var(--surface)",
        card: "var(--card)",
        hover: "var(--hover)",
        border: "var(--border)",
        divider: "var(--divider)",
        muted: {
          DEFAULT: "var(--muted-foreground)",
          foreground: "var(--muted-foreground)",
        },
        secondary: "var(--secondary)",
        tertiary: "var(--tertiary)",

        accent: {
          DEFAULT: "var(--accent)",
          light: "var(--accent-light)",
          foreground: "var(--accent-foreground)",
        },
        primary: {
          DEFAULT: "var(--primary)",
          foreground: "var(--primary-foreground)",
        },
        destructive: {
          DEFAULT: "var(--destructive)",
          foreground: "var(--destructive-foreground)",
          bg: "var(--destructive-bg)",
        },
        success: {
          DEFAULT: "var(--success)",
          bg: "var(--success-bg)",
        },
        warning: {
          DEFAULT: "var(--warning)",
          bg: "var(--warning-bg)",
        },
        info: {
          DEFAULT: "var(--info)",
          bg: "var(--info-bg)",
        },

        "collab-teal": {
          DEFAULT: "var(--collab-teal)",
          light: "var(--collab-teal-light)",
          muted: "var(--collab-teal-muted)",
        },
        "agent-amber": {
          DEFAULT: "var(--agent-amber)",
          light: "var(--agent-amber-light)",
          muted: "var(--agent-amber-muted)",
        },

        "presence-online": "var(--presence-online)",
        "presence-idle": "var(--presence-idle)",
        "presence-dnd": "var(--presence-dnd)",
        "presence-offline": "var(--presence-offline)",
      },
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
      borderRadius: {
        none: "0",
        sm: "var(--radius-sm)",
        DEFAULT: "var(--radius-md)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "9999px",
      },
      ringColor: {
        DEFAULT: "var(--ring)",
        accent: "var(--accent)",
      },
      maxWidth: {
        content: "1200px",
        prose: "65ch",
        channel: "880px",
      },
    },
  },
  plugins: [
    // `mobile-sheet:` — applies only on touch devices in a phone-sized
    // viewport, i.e. when the modal should render as a bottom-sheet.
    // Narrow desktop windows (mouse / trackpad) are intentionally
    // excluded so resizing a browser doesn't switch to a bottom-sheet.
    plugin(({ addVariant }) => {
      addVariant(
        "mobile-sheet",
        "@media (pointer: coarse) and (max-width: 640px)",
      );
    }),
  ],
};
