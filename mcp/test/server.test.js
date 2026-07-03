// End-to-end MCP test: boot the bus, then connect a real MCP client to the whileaway-mcp server
// over stdio, list tools, and call one. Validates the SDK wiring (tool schemas + handlers) — the
// closest automatable proxy for "an agent connects and pushes a deck".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "../../server/src/index.js");
const MCP = path.join(__dirname, "../src/index.js");
const PORT = 4223;
const BASE = `http://localhost:${PORT}`;
const KEY = "vf_pk_mcpsrv";
let bus, client, transport;

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + "/health")).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("bus did not become healthy");
}

before(async () => {
  const stateFile = path.join(os.tmpdir(), `wa-mcpsrv-${process.pid}.json`);
  bus = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT), VIBEFEED_KEY: KEY, VIBEFEED_STATE: stateFile, RUN_DEFAULT_PUSHERS: "0", AUTH_MODE: "none" },
    stdio: "ignore",
  });
  await waitForHealth();
  transport = new StdioClientTransport({
    command: "node",
    args: [MCP],
    env: { ...process.env, WHILEAWAY_URL: BASE, WHILEAWAY_TOKEN: KEY, WHILEAWAY_LANE: "personal" },
  });
  client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(transport);
});
after(async () => {
  try { await client?.close(); } catch { /* already down */ }
  if (bus) bus.kill();
});

test("server advertises all six tools with non-empty descriptions", async () => {
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, ["create_lane", "get_feed_status", "get_history", "list_lanes", "push_card", "push_deck"]);
  for (const t of tools) assert.ok(t.description && t.description.length > 40, `${t.name} needs a real description`);
});

test("push_card tool call reaches the bus and returns an id", async () => {
  const res = await client.callTool({ name: "push_card", arguments: { lane: "mcp-e2e", title: "from an MCP client" } });
  assert.ok(!res.isError, `tool errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse(res.content[0].text);
  assert.ok(payload.id, "expected an item id in the response");
  assert.equal(payload.lane, "mcp-e2e");
});

test("no-arg tools (list_lanes, get_feed_status) execute without a schema error", async () => {
  const lanes = await client.callTool({ name: "list_lanes", arguments: {} });
  assert.ok(!lanes.isError, `list_lanes errored: ${JSON.stringify(lanes.content)}`);
  assert.ok(Array.isArray(JSON.parse(lanes.content[0].text).lanes));

  const status = await client.callTool({ name: "get_feed_status", arguments: {} });
  assert.ok(!status.isError, `get_feed_status errored: ${JSON.stringify(status.content)}`);
  assert.ok(JSON.parse(status.content[0].text).health.ok);
});

test("push_deck tool call creates a recurring deck", async () => {
  const res = await client.callTool({
    name: "push_deck",
    arguments: { lane: "mcp-spanish", cooldown_s: 86400, max: 14, cards: [{ title: "hola = hello" }, { title: "gracias = thanks" }] },
  });
  assert.ok(!res.isError, `tool errored: ${JSON.stringify(res.content)}`);
  const payload = JSON.parse(res.content[0].text);
  assert.equal(payload.count, 2);
});
