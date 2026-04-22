/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Selects the active design-system preset at build time. Resolved by
   * `vite.config.ts` to `src/design-systems/<id>.css` and exposed under
   * the `@collabai-design-system.css` virtual import. Defaults to
   * `"default"` when unset.
   */
  readonly VITE_DESIGN_SYSTEM?: "default" | "conservative";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Build-time string injected by `vite.config.ts` (define plugin). */
declare const __COLLAB_DESIGN_SYSTEM__: "default" | "conservative";
