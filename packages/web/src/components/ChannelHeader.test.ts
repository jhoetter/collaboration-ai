/**
 * Structural guard for the channel header upgrade.
 *
 * The previous header opened the channel-settings modal only via a
 * deeply-nested kebab menu and offered no in-channel search. The new
 * header makes the channel name itself a button that opens the
 * tabbed `ChannelDetailPanel` on the About tab and adds a dedicated
 * "search in channel" icon button.
 *
 * Reading the source as text keeps the test fast and avoids the
 * heavy `react-router` + `react-query` + zustand setup the full
 * component would otherwise require.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const headerSource = readFileSync(join(here, "ChannelHeader.tsx"), "utf8");

describe("ChannelHeader", () => {
  it("imports the new ChannelDetailPanel rather than the old modal", () => {
    expect(headerSource).toMatch(/from "\.\/ChannelDetailPanel\.tsx"/);
    expect(headerSource).not.toMatch(/ChannelSettingsModal/);
  });

  it("exposes a clickable header button that defaults to the About tab", () => {
    expect(headerSource).toMatch(/openDetail\("about"\)/);
    expect(headerSource).toMatch(/<button[\s\S]*?onClick=\{\(\) => openDetail\("about"\)\}/);
  });

  it("offers a Search-in-channel icon button that seeds the topbar", () => {
    expect(headerSource).toMatch(/searchInChannel/);
    expect(headerSource).toMatch(/setSearchQuery\(`in:#\$\{name\} `\)/);
  });

  it("renders ChannelDetailPanel with the chosen tab when open", () => {
    expect(headerSource).toMatch(/<ChannelDetailPanel[\s\S]*?initialTab=\{detailTab\}/);
  });
});
