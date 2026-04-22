/**
 * Structural guard for the composer chrome.
 *
 * Reads the source file directly and asserts that:
 *   1. the outer composer wrapper does not use `overflow-hidden`
 *      (which would clip the floating popovers — see the bug fix
 *      that motivated the Lexical rewrite),
 *   2. the popovers (PlusMenu, mention list, slash list, emoji
 *      picker) are rendered through `PopoverPortal` so they always
 *      escape any ancestor clipping context.
 *
 * Reading the source as text keeps the test fast and deterministic
 * without needing to mount Lexical / set up a JSDOM tree.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const composerSource = readFileSync(join(here, "Composer.tsx"), "utf8");

describe("Composer chrome", () => {
  it("does not use overflow-hidden on the outer composer wrapper", () => {
    // Find the outermost rounded card the composer renders.
    const match = composerSource.match(/className="group\/composer ([^"]+)"/);
    expect(match, "composer wrapper className should be present").not.toBeNull();
    const classes = match![1];
    expect(classes).not.toMatch(/\boverflow-hidden\b/);
  });

  it("renders every floating UI through PopoverPortal", () => {
    const popoverCount = (composerSource.match(/<PopoverPortal/g) ?? []).length;
    // PlusMenu, mention list, slash list, emoji picker.
    expect(popoverCount).toBeGreaterThanOrEqual(4);
  });
});
