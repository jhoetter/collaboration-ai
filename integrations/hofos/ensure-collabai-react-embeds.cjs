#!/usr/bin/env node
/* eslint-disable */
/**
 * Postinstall script copied into
 * packages/hof-components/data-app/ui/scripts/ in hof-os.
 *
 * Reads infra/collabai.lock.json, downloads
 * `react_embeds_tarball`, and extracts it under
 * `node_modules/@collabai/react-embeds/`. Soft-fails if neither the
 * lockfile nor a sibling collaboration-ai checkout is available;
 * the chat sidebar lazy-imports the package and renders null in that
 * case so the rest of the data-app keeps working.
 *
 * Mirrors ensure-officeai-react-editors.cjs almost line-for-line so a
 * single review can confirm both stay in sync.
 */
const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { execSync } = require("node:child_process");

const PKG = "@collabai/react-embeds";
const STAMP_FILE = ".collabai-react-embeds.version";

function findRepoRoot(start) {
  let dir = start;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, "infra", "collabai.lock.json"))) return dir;
    dir = path.dirname(dir);
  }
  return null;
}

function readLock(repoRoot) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(repoRoot, "infra", "collabai.lock.json"), "utf8"),
    );
  } catch {
    return null;
  }
}

function targetDir() {
  return path.resolve(__dirname, "..", "node_modules", PKG);
}

function alreadyInstalled(version) {
  try {
    return fs.readFileSync(path.join(targetDir(), STAMP_FILE), "utf8").trim() === version;
  } catch {
    return false;
  }
}

function downloadFollow(url, dest) {
  return new Promise((resolve, reject) => {
    function get(u) {
      https
        .get(u, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            res.resume();
            return get(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`GET ${u} -> ${res.statusCode}`));
          }
          const out = fs.createWriteStream(dest);
          res.pipe(out);
          out.on("finish", () => out.close(resolve));
        })
        .on("error", reject);
    }
    get(url);
  });
}

function extract(tarball, into) {
  fs.rmSync(into, { recursive: true, force: true });
  fs.mkdirSync(into, { recursive: true });
  execSync(`tar -xzf ${tarball} -C ${into} --strip-components=1`, { stdio: "inherit" });
}

function siblingFallback(version) {
  const sibling = path.resolve(__dirname, "..", "..", "..", "..", "..", "..", "collaboration-ai");
  if (!fs.existsSync(path.join(sibling, "packages", "react-embeds"))) return false;
  console.warn(`[collabai] using sibling checkout at ${sibling}`);
  execSync(
    `pnpm --filter ${PKG} --prod deploy ${targetDir()}`,
    { stdio: "inherit", cwd: sibling },
  );
  fs.writeFileSync(path.join(targetDir(), STAMP_FILE), `sibling@${version || "dev"}\n`);
  return true;
}

async function main() {
  const repoRoot = findRepoRoot(__dirname);
  if (!repoRoot) {
    console.warn("[collabai] no infra/collabai.lock.json found; skipping");
    return;
  }
  const lock = readLock(repoRoot);
  const version = lock?.react_embeds_version ?? lock?.version ?? null;
  const tarball = lock?.react_embeds_tarball ?? null;

  if (version && alreadyInstalled(version)) {
    return;
  }

  if (tarball) {
    const tmp = path.join(repoRoot, ".cache", `collabai-react-embeds-${version}.tgz`);
    fs.mkdirSync(path.dirname(tmp), { recursive: true });
    try {
      await downloadFollow(tarball, tmp);
      extract(tmp, targetDir());
      fs.writeFileSync(path.join(targetDir(), STAMP_FILE), `${version}\n`);
      console.log(`[collabai] installed @collabai/react-embeds@${version}`);
      return;
    } catch (err) {
      console.warn(`[collabai] tarball install failed: ${err.message}`);
    }
  }

  if (siblingFallback(version)) return;

  console.warn(
    "[collabai] react-embeds unavailable; chat sidebar will hide itself.",
  );
}

main().catch((err) => {
  console.warn(`[collabai] postinstall soft-failed: ${err.message}`);
  process.exit(0);
});
