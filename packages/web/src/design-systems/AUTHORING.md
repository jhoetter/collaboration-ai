# Authoring a design-system preset

A "preset" is **one CSS file** that gets resolved at build time via the
`@collabai-design-system.css` Vite alias. Picking a preset is just an
env var:

```bash
pnpm dev                                 # default
VITE_DESIGN_SYSTEM=conservative pnpm dev # conservative
```

The selected file is `@import`-ed once from `packages/web/src/index.css`,
which then loads Tailwind. Every UI token (colors, fonts, radii)
defined in the preset is exposed as a CSS custom property and
referenced through the Tailwind preset (`packages/design-tokens/src/tailwind-preset.ts`).
That means semantic utilities like `bg-background`, `text-foreground`,
`border-border`, `text-accent` swap automatically when the preset
changes — no component edits required.

## To add a new preset

1. **Copy `default.css`** as a starting point and rename it (e.g. `playful.css`).
2. Create `tokens-<name>.css` next to the existing token files. It
   **must** define every variable in the token contract (see below) —
   missing tokens will fall back to whatever was last set, which is
   surprising. Use `tokens-default.css` as the canonical reference.
3. Define light values on `:root`, dark via both
   `:root.collab-theme-dark` and the `@media (prefers-color-scheme: dark) :root:not(.collab-theme-light):not(.collab-theme-dark)` block.
4. Update `<name>.css` to `@import "./tokens-<name>.css"; @import "./shell.css";`.
5. Register the id in `packages/web/vite.config.ts` (`DESIGN_SYSTEM_IDS`).
6. Run `VITE_DESIGN_SYSTEM=<name> pnpm dev` and toggle light/dark from
   the user menu to verify both schemes.

## Token contract

The set every preset must implement (names as authored on `:root`):

- **Surfaces** — `--background`, `--foreground`, `--surface`, `--card`,
  `--hover`, `--border` (alias: `--divider`)
- **Text** — `--muted-foreground` (alias: `--secondary`), `--tertiary`
- **Accent** — `--accent`, `--accent-light`, `--accent-foreground`
- **Primary** — `--primary`, `--primary-foreground`
- **Status** — `--destructive`, `--destructive-foreground`,
  `--destructive-bg`, `--success`, `--success-bg`, `--warning`,
  `--warning-bg`, `--info`, `--info-bg`, `--error` (alias of destructive)
- **Brand** — `--collab-teal`, `--collab-teal-light`, `--collab-teal-muted`,
  `--agent-amber`, `--agent-amber-light`, `--agent-amber-muted`
- **Presence** — `--presence-online`, `--presence-idle`, `--presence-dnd`,
  `--presence-offline`
- **Type** — `--font-sans`, `--font-mono`, `--body-font-features`
- **Radii** — `--radius-sm`, `--radius-md`, `--radius-lg`, `--radius-xl`
- **Focus ring** — `--ring`
- **Color-scheme hint** — `color-scheme: light | dark`

## Light / dark resolution

Themes are toggled at runtime by adding `collab-theme-light` or
`collab-theme-dark` to `<html>` (see `packages/web/src/lib/theme/colorScheme.ts`).
When neither class is present, `prefers-color-scheme` decides.

## Why preset = file (not preset = `<select>` at runtime)?

Mirrors hof-os's model: shipping multiple visual languages is a
deployment-time decision, not a per-user choice. This keeps bundles
small (one preset's CSS in the build) and allows radically different
typography (e.g. serif vs. sans) without runtime FOUT.
