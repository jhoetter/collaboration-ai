import { colors } from "./colors";
import { fontFamily } from "./typography";
import { borderRadius, borderWidth } from "./spacing";

/**
 * Tailwind v3 preset for collaboration-ai. With Tailwind v4 (used in the
 * web UI), tokens are emitted via CSS custom properties in `app.css`
 * inside an `@theme {}` block — this preset is for downstream consumers
 * that still use v3.
 */
export const collabAIPreset = {
  theme: {
    extend: {
      colors: {
        background: "var(--background)",
        foreground: "var(--foreground)",
        secondary: "var(--secondary)",
        tertiary: "var(--tertiary)",
        divider: "var(--divider)",
        hover: "var(--hover)",
        surface: "var(--surface)",
        accent: "var(--accent)",
        "accent-light": "var(--accent-light)",

        "collab-teal": {
          DEFAULT: colors.collabTeal,
          light: colors.collabTealLight,
          muted: colors.collabTealMuted,
        },
        "agent-amber": {
          DEFAULT: colors.agentAmber,
          light: colors.agentAmberLight,
          muted: colors.agentAmberMuted,
        },

        "presence-online": colors.presenceOnline,
        "presence-idle": colors.presenceIdle,
        "presence-dnd": colors.presenceDnd,
        "presence-offline": colors.presenceOffline,

        warning: colors.warning,
        error: colors.error,
        info: colors.info,
        success: colors.success,
      },
      fontFamily: {
        sans: fontFamily.sans,
        mono: fontFamily.mono,
      },
      borderRadius: { ...borderRadius },
      borderWidth: { ...borderWidth },
      maxWidth: {
        content: "1200px",
        prose: "65ch",
        channel: "880px",
      },
    },
  },
};
