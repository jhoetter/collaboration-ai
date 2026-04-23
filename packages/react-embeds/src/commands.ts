/**
 * Pure command-palette adapter.
 *
 * Returns the canonical collab-ai action surface
 * (create channel, new DM, set presence, sign out) as a flat list of
 * {@link CommandPaletteItem}s so a host (e.g. the hof-os data-app)
 * can interleave them with its own commands inside a single Cmd+K
 * palette UI. Mirrors the office-ai `editorCommands(ctx)` shape.
 *
 * No React, no router, no store side-effects at call time — every
 * action is a small lambda that runs only when the host invokes
 * `perform()` on the chosen item. That makes the function safe to
 * re-call on every keystroke for fuzzy-match recomputation.
 */
import { callFunction } from "../../web/src/lib/api.ts";
import { clearIdentity } from "../../web/src/lib/identity.ts";
import type { CollabAiCommandContext, CommandPaletteItem } from "./contract.js";

const GROUP = "Collab";

export function collabaiCommands(ctx: CollabAiCommandContext): CommandPaletteItem[] {
  const items: CommandPaletteItem[] = [];

  if (ctx.openCreateChannel) {
    items.push({
      id: "collabai:create-channel",
      group: GROUP,
      label: "Create channel",
      hint: "Open the new-channel dialog",
      perform: () => ctx.openCreateChannel?.(),
    });
  }

  if (ctx.openNewDm) {
    items.push({
      id: "collabai:new-dm",
      group: GROUP,
      label: "New direct message",
      hint: "Start a DM with a workspace member",
      perform: () => ctx.openNewDm?.(),
    });
  }

  items.push(
    {
      id: "collabai:set-active",
      group: GROUP,
      label: "Set status: active",
      perform: () => callFunction("users:set-presence", { status: "active" }).catch(() => undefined),
    },
    {
      id: "collabai:set-away",
      group: GROUP,
      label: "Set status: away",
      perform: () => callFunction("users:set-presence", { status: "away" }).catch(() => undefined),
    },
    {
      id: "collabai:open-activity",
      group: GROUP,
      label: "Open activity feed",
      hint: "Pending mentions + agent proposals",
      perform: () => ctx.navigate?.("/activity"),
    },
    {
      id: "collabai:sign-out",
      group: GROUP,
      label: "Sign out of collab-ai",
      perform: () => {
        clearIdentity();
        if (typeof location !== "undefined") location.reload();
      },
    }
  );

  return items;
}
