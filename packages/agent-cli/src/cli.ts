#!/usr/bin/env node
import { Command } from "commander";
import { spawn } from "node:child_process";
import { CollabClient } from "./client.ts";
import { loadConfig, saveConfig } from "./config.ts";

const program = new Command();
program
  .name("collab-agent")
  .description("CLI for collaboration-ai. Drives the FastAPI surface from a terminal or another agent.")
  .version("0.0.1");

program
  .command("login")
  .description("Persist a collab-agent session to ~/.collab-agent/token.json")
  .requiredOption("--url <url>", "Base URL of the collabai server (e.g. https://collab.example.com)")
  .requiredOption("--token <token>", "Bearer token returned by /api/agent-auth/device")
  .requiredOption("--workspace <ws>", "Workspace id")
  .requiredOption("--actor <actor>", "Actor id (your user id, or your agent id)")
  .action((opts) => {
    saveConfig({
      baseUrl: opts.url,
      token: opts.token,
      workspaceId: opts.workspace,
      actorId: opts.actor,
    });
    console.log("Logged in.");
  });

program
  .command("who-am-i")
  .description("Print the current session details.")
  .action(() => {
    const cfg = loadConfig();
    const { token: _t, ...rest } = cfg;
    console.log(JSON.stringify(rest, null, 2));
  });

program
  .command("send")
  .description("Send a chat message in the given channel.")
  .requiredOption("--channel <channelId>")
  .requiredOption("--content <content>")
  .action(async (opts) => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const res = await client.send(opts.channel, opts.content);
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("unread")
  .description("Per-channel unread counts.")
  .action(async () => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const rows = await client.unread();
    rows.sort((a, b) => b.mention_count - a.mention_count || b.unread - a.unread);
    for (const row of rows) {
      console.log(
        `${row.channel_id.padEnd(24)} unread=${String(row.unread).padStart(4)}  mentions=${row.mention_count}`,
      );
    }
  });

program
  .command("notifications")
  .description("List recent notifications.")
  .option("--limit <n>", "max", "20")
  .action(async (opts) => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const rows = await client.notifications(parseInt(opts.limit, 10));
    console.log(JSON.stringify(rows, null, 2));
  });

program
  .command("approve <proposalId>")
  .description("Approve a staged proposal.")
  .action(async (id) => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const res = await client.approveProposal(id);
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("reject <proposalId>")
  .description("Reject a staged proposal.")
  .option("--reason <reason>", "Optional rejection reason")
  .action(async (id, opts) => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const res = await client.rejectProposal(id, opts.reason);
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("call <function-name>")
  .description("Call any @function endpoint by name with a JSON body.")
  .option("--json <json>", "JSON body", "{}")
  .action(async (name, opts) => {
    const cfg = loadConfig();
    const client = new CollabClient(cfg);
    const body = JSON.parse(opts.json);
    const res = await client.call(name, body);
    console.log(JSON.stringify(res, null, 2));
  });

program
  .command("mcp serve")
  .description("Spawn the Python collabai-mcp bridge and proxy stdio.")
  .action(() => {
    const mcp = spawn("collabai-mcp", [], { stdio: "inherit" });
    mcp.on("exit", (code) => process.exit(code ?? 0));
  });

program.parseAsync().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
