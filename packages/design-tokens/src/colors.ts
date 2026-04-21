/**
 * collaboration-ai brand colors.
 *
 * Notion-like neutral palette (matches the shape used by @officeai/design-tokens
 * and @hofos/design-tokens), with collab-specific accent: a muted teal for
 * "channel / room" and a warm amber for "agent activity" so the eye can
 * distinguish human and agent participation at a glance.
 */

export const colors = {
  /* Light mode base */
  background: "#FFFFFF",
  foreground: "#37352F",
  secondary: "#787774",
  tertiary: "#C3C2C1",
  divider: "#E9E9E7",
  hover: "#F7F7F5",
  surface: "#FBFBFA",
  accent: "#0E8A7E",
  accentLight: "#E6F4F2",

  /* Dark mode base */
  backgroundDark: "#191919",
  foregroundDark: "#E3E2E0",
  secondaryDark: "#9B9A97",
  tertiaryDark: "#5A5A58",
  dividerDark: "#2F2F2F",
  hoverDark: "#252525",
  surfaceDark: "#202020",
  accentDark: "#34B0A1",
  accentLightDark: "#142B28",

  /* Brand accents (collaboration-ai) */
  collabTeal: "#0E8A7E",
  collabTealLight: "#E6F4F2",
  collabTealMuted: "#0E8A7E33",
  agentAmber: "#D97706",
  agentAmberLight: "#FEF3E6",
  agentAmberMuted: "#D9770633",

  /* Semantic status */
  warning: "#E57A2E",
  error: "#D84B3E",
  info: "#787774",
  success: "#2F7D59",

  /* Presence */
  presenceOnline: "#22A55B",
  presenceIdle: "#E0A028",
  presenceDnd: "#D84B3E",
  presenceOffline: "#9B9A97",

  /* Neutral grays */
  gray50: "#FAFAFA",
  gray100: "#F5F5F5",
  gray200: "#E9E9E7",
  gray300: "#C3C2C1",
  gray400: "#9B9A97",
  gray500: "#787774",
  gray600: "#4B5563",
  gray700: "#374151",
  gray800: "#1F2937",
  gray900: "#111827",
} as const;

export type ColorToken = keyof typeof colors;
