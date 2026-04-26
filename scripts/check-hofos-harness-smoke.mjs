#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(new URL("..", import.meta.url).pathname);
const config = JSON.parse(readFileSync(join(ROOT, "hofos-ui.config.json"), "utf8"));

function fail(message) {
  console.error(`hofos-harness-smoke: ${message}`);
  process.exitCode = 1;
}

for (const route of ["/chat", "/chat/c/example", "/chat/c/example?thread=example-message"]) {
  if (!config.harness.requiredRoutes.includes(route)) {
    fail(`missing route smoke coverage for ${route}`);
  }
}

if (config.harness.requiredProxyPrefix !== "/api/chat") {
  fail("expected /api/chat proxy prefix");
}

if (!/Office-AI/.test(config.harness.officeAiAttachmentContract)) {
  fail("missing Office-AI attachment contract");
}

const attachmentViewer = readFileSync(join(ROOT, "packages/web/src/lib/AttachmentViewer.tsx"), "utf8");
if (!attachmentViewer.includes("@officeai/react-editors")) {
  fail("attachment smoke coverage must keep Office-AI editor imports in the standalone harness");
}

const workspaceShell = readFileSync(join(ROOT, "packages/web/src/pages/WorkspaceShell.tsx"), "utf8");
if (!workspaceShell.includes("CommandPalette")) {
  fail("command palette smoke coverage must keep CommandPalette mounted");
}

if (workspaceShell.includes("/w/default") || attachmentViewer.includes("/w/default")) {
  fail("hofOS-mode smoke coverage forbids public /w/default URLs");
}

if (!existsSync(join(ROOT, "release-out/hofos-ui/collabai-ui-source/hofos-ui-export-manifest.json"))) {
  console.warn(
    "hofos-harness-smoke warning: export manifest not present; run pnpm run export:hofos-ui before release."
  );
}

if (process.exitCode) process.exit(process.exitCode);
console.log("hofos-harness-smoke: ok (collabai)");
