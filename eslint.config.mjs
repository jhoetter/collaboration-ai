// @ts-check
import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import importPlugin from "eslint-plugin-import";

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.turbo/**",
      "**/.next/**",
      "**/coverage/**",
      "**/__pycache__/**",
      "**/.venv/**",
      "app/**",
      "cli/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        console: "readonly",
        process: "readonly",
        window: "readonly",
        document: "readonly",
        globalThis: "readonly",
        navigator: "readonly",
        confirm: "readonly",
        alert: "readonly",
        prompt: "readonly",
        // Browser/runtime globals used by the web package.
        fetch: "readonly",
        WebSocket: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        location: "readonly",
        crypto: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        requestAnimationFrame: "readonly",
        cancelAnimationFrame: "readonly",
        Image: "readonly",
        File: "readonly",
        Blob: "readonly",
        FileReader: "readonly",
        FormData: "readonly",
        DataTransfer: "readonly",
        ResizeObserver: "readonly",
        MutationObserver: "readonly",
        IntersectionObserver: "readonly",
        CustomEvent: "readonly",
        Event: "readonly",
        EventTarget: "readonly",
        KeyboardEvent: "readonly",
        MouseEvent: "readonly",
        DragEvent: "readonly",
        ClipboardEvent: "readonly",
        FocusEvent: "readonly",
        Node: "readonly",
        Text: "readonly",
        HTMLDivElement: "readonly",
        HTMLInputElement: "readonly",
        HTMLButtonElement: "readonly",
        HTMLElement: "readonly",
        HTMLImageElement: "readonly",
        SVGSVGElement: "readonly",
        HTMLCanvasElement: "readonly",
        CanvasRenderingContext2D: "readonly",
        EventListener: "readonly",
        // React's classic JSX runtime is implicit in TS/Vite, but the
        // codebase still references the `React.*` namespace for type
        // annotations (e.g. `React.ReactNode`). Mark it as a known
        // global so eslint's `no-undef` rule doesn't trip over it.
        React: "readonly",
        JSX: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      import: importPlugin,
    },
    rules: {
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-explicit-any": "warn",
      "import/no-restricted-paths": [
        "error",
        {
          zones: [
            {
              target: "./packages/design-tokens",
              from: ["./packages/ui", "./packages/react-embeds"],
              message: "design-tokens is a leaf package; it must not import from ui/react-embeds.",
            },
          ],
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/dist/**"],
              message: "Import from package source, not built dist/.",
            },
          ],
        },
      ],
    },
  },
];
