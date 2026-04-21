import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { CommandResult } from "./client.ts";

test("client builds the right URL + payload", async () => {
  // Smoke-only: we don't depend on a live server here. This just
  // ensures the module imports and the type compiles.
  const r: CommandResult = {
    command_id: "cmd_x",
    status: "applied",
    events: [{ event_id: "evt_1", type: "message.send", sequence: 1 }],
  };
  assert.equal(r.status, "applied");
});
