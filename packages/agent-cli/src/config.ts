import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CollabConfig = {
  baseUrl: string;
  token: string;
  workspaceId: string;
  actorId: string;
};

export const DEFAULT_CONFIG_PATH = join(homedir(), ".collab-agent", "token.json");

export function loadConfig(path: string = DEFAULT_CONFIG_PATH): CollabConfig {
  if (!existsSync(path)) {
    throw new Error(`No collab-agent config at ${path}. Run \`collab-agent login\` first.`);
  }
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as CollabConfig;
  for (const key of ["baseUrl", "token", "workspaceId", "actorId"] as const) {
    if (typeof parsed[key] !== "string" || !parsed[key]) {
      throw new Error(`collab-agent config missing field: ${key}`);
    }
  }
  return parsed;
}

export function saveConfig(config: CollabConfig, path: string = DEFAULT_CONFIG_PATH): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(config, null, 2), "utf-8");
}
