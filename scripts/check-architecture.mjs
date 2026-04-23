#!/usr/bin/env node
/**
 * collaboration-ai architecture guard.
 *
 * Mirrors office-ai/scripts/check-architecture.mjs. Enforces the package
 * dependency DAG by reading every packages/*\/package.json and verifying
 * that its `dependencies` + `peerDependencies` only reference allowed
 * sibling workspaces.
 *
 *   design-tokens    ← leaf
 *   ui               → design-tokens
 *   react-embeds     → design-tokens, ui
 *
 * Headless leaf packages (design-tokens) additionally MUST NOT depend on
 * react / react-dom.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const PACKAGES_DIR = join(REPO_ROOT, "packages");

const ALLOWED = {
  "@collabai/design-tokens": new Set(),
  "@collabai/ui": new Set(["@collabai/design-tokens"]),
  "@collabai/react-embeds": new Set(["@collabai/design-tokens", "@collabai/ui"]),
  // App-level packages may consume the public component graph but are
  // not themselves consumed by other packages — list them here so the
  // guard recognises them rather than failing the verify chain.
  "@collabai/agent-cli": new Set(["@collabai/design-tokens", "@collabai/ui", "@collabai/react-embeds"]),
  "@collabai/web": new Set(["@collabai/design-tokens", "@collabai/ui", "@collabai/react-embeds"]),
};

const REACT_BANNED_FOR = new Set(["@collabai/design-tokens"]);

const failures = [];

for (const entry of readdirSync(PACKAGES_DIR)) {
  const pkgPath = join(PACKAGES_DIR, entry);
  if (!statSync(pkgPath).isDirectory()) continue;
  const manifestPath = join(pkgPath, "package.json");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch {
    continue;
  }
  const name = manifest.name;
  if (!name?.startsWith("@collabai/")) continue;

  const allowed = ALLOWED[name];
  if (!allowed) {
    failures.push(`Unknown package "${name}" — add to ALLOWED in scripts/check-architecture.mjs`);
    continue;
  }

  const deps = {
    ...(manifest.dependencies ?? {}),
    ...(manifest.peerDependencies ?? {}),
  };

  for (const dep of Object.keys(deps)) {
    if (dep.startsWith("@collabai/") && !allowed.has(dep)) {
      failures.push(`${name} depends on ${dep} (not allowed). Allowed: ${[...allowed].join(", ") || "(none)"}`);
    }
    if (REACT_BANNED_FOR.has(name) && (dep === "react" || dep === "react-dom")) {
      failures.push(`${name} must remain headless (no react / react-dom). Found dep: ${dep}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Architecture check failed:");
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}

console.log("Architecture check OK.");
