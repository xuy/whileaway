// Reproduces every docs/EXAMPLES.md prompt against a clean bus (T-51 acceptance). Boots the bus,
// runs each example's exact whileaway-mcp call, and asserts it lands as documented.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { WhileawayClient } from "../src/client.js";
import { EXAMPLES } from "../examples/examples.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "../../server/src/index.js");
const PORT = 4224;
const BASE = `http://localhost:${PORT}`;
const KEY = "wa_pk_examples";
let proc, client;

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + "/health")).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("bus did not become healthy");
}

before(async () => {
  const stateFile = path.join(os.tmpdir(), `wa-examples-${process.pid}.json`);
  proc = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT), WHILEAWAY_KEY: KEY, WHILEAWAY_STATE: stateFile, RUN_DEFAULT_PUSHERS: "0", AUTH_MODE: "none" },
    stdio: "ignore",
  });
  await waitForHealth();
  client = new WhileawayClient({ base: BASE, token: KEY, defaultLane: "personal" });
});
after(() => { if (proc) proc.kill(); });

// Map MCP tool name (as documented) → client method.
const METHOD = { push_deck: "pushDeck", push_card: "pushCard", create_lane: "createLane" };

for (const ex of EXAMPLES) {
  test(`example "${ex.id}" reproduces: ${ex.prompt}`, async () => {
    const out = await client[METHOD[ex.tool]](ex.args);
    if (ex.expect.count != null) {
      assert.equal(out.count, ex.expect.count, `${ex.id} should push ${ex.expect.count} cards`);
      for (const item of out.items) assert.ok(item.id, "each pushed card has an id");
    }
    if (ex.expect.id) assert.ok(out.id, `${ex.id} should return an item id`);
    // The lane the example targets exists afterward.
    const lanes = await client.listLanes();
    const laneId = client.laneId(ex.args.lane);
    assert.ok(lanes.some((l) => l.id === laneId), `lane ${laneId} should exist after ${ex.id}`);
  });
}

test("recurring deck actually re-delivers (spaced repetition works end to end)", async () => {
  // Push a tiny recurring deck to a public lane and confirm a fresh subscriber gets a card twice.
  await client.createLane({ lane: "sr-check", visibility: "public" });
  await client.pushDeck({ lane: "sr-check", cooldown_s: 0, max: 2, cards: [{ title: "repeat me" }] });
  let count = 0;
  for (let i = 0; i < 10; i++) {
    const r = await fetch(BASE + "/v1/feed/next", { headers: { "X-Whileaway-User": "sr-consumer" } });
    if (r.status === 204) break;
    const c = await r.json();
    if (c.title === "repeat me") count++;
  }
  assert.equal(count, 2, "recurring card with max=2 is delivered exactly twice");
});
