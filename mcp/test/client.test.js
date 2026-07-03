// Integration tests for the whileaway-mcp client: boots the real bus as a child process and
// drives the client end-to-end, then pulls the feed to confirm delivery semantics. Also unit-
// tests the pure payload mapping. This is the closest automatable proxy for the T-20 acceptance
// ("one-sentence prompt produces a correctly-repeating deck").
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import { WhileawayClient, normalizeRepeat } from "../src/client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(__dirname, "../../server/src/index.js");
const PORT = 4222;
const BASE = `http://localhost:${PORT}`;
const KEY = "vf_pk_mcptest";
let proc, client;

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + "/health")).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("bus did not become healthy");
}
// Pull the single next card for a fresh consumer id (auto-subscribed to public lanes).
async function pullAs(userId) {
  const r = await fetch(BASE + "/v1/feed/next", { headers: { "X-Whileaway-User": userId } });
  return r.status === 204 ? null : r.json();
}
// Drain a consumer's whole feed to a list of titles. Robust to round-robin interleaving across
// the several public lanes a fresh consumer auto-subscribes to; terminates when nothing's left.
async function drain(userId, cap = 80) {
  const titles = [];
  for (let i = 0; i < cap; i++) { const c = await pullAs(userId); if (!c) break; titles.push(c.title); }
  return titles;
}

before(async () => {
  const stateFile = path.join(os.tmpdir(), `wa-mcp-${process.pid}.json`);
  proc = spawn("node", [SERVER], {
    env: { ...process.env, PORT: String(PORT), WHILEAWAY_KEY: KEY, WHILEAWAY_STATE: stateFile, RUN_DEFAULT_PUSHERS: "0", AUTH_MODE: "none" },
    stdio: "ignore",
  });
  await waitForHealth();
  client = new WhileawayClient({ base: BASE, token: KEY, defaultLane: "personal" });
});
after(() => { if (proc) proc.kill(); });

// --- pure mapping (no server) ----------------------------------------------
test("normalizeRepeat maps strings and objects to the bus shape", () => {
  assert.equal(normalizeRepeat(null), undefined);
  assert.deepEqual(normalizeRepeat("once"), { mode: "once" });
  assert.deepEqual(normalizeRepeat("recurring"), { mode: "recurring" });
  assert.deepEqual(normalizeRepeat({ mode: "recurring", cooldown_s: 3600, max: 5 }), { mode: "recurring", cooldown_s: 3600, max: 5 });
});

test("buildCardBody nests delivery fields and passes dedupe_key through", () => {
  const c = new WhileawayClient({ base: BASE, token: KEY });
  const body = c.buildCardBody({ title: "T", body: "B", class: "must_see", priority: 90, dedupe_key: "k", repeat: { mode: "recurring", cooldown_s: 60 } });
  assert.equal(body.title, "T");
  assert.equal(body.dedupe_key, "k");
  assert.deepEqual(body.delivery, { class: "must_see", priority: 90, repeat: { mode: "recurring", cooldown_s: 60 } });
});

// --- lanes -----------------------------------------------------------------
test("create_lane then list_lanes shows the lane", async () => {
  await client.createLane({ lane: "reading", title: "Reading", visibility: "public" });
  const lanes = await client.listLanes();
  assert.ok(lanes.some((l) => l.id === "reading" && l.title === "Reading"));
});

// --- push_card + delivery --------------------------------------------------
test("push_card lands and is delivered to a subscriber", async () => {
  await client.createLane({ lane: "news", visibility: "public" });
  const res = await client.pushCard({ lane: "news", title: "Breaking: it works" });
  assert.ok(res.id);
  assert.equal(res.deduped, false);
  const card = await pullAs("consumer-news");
  assert.equal(card.title, "Breaking: it works");
});

test("push_card auto-creates a missing lane (push to a never-created lane succeeds, no 404)", async () => {
  // If the lane weren't created first, the item POST would 404 and pushCard would throw.
  const res = await client.pushCard({ lane: "auto-lane", title: "auto-created" });
  assert.ok(res.id);
  assert.equal(res.deduped, false);
  assert.equal(res.lane, "auto-lane");
});

test("card pushed to a NEW private lane reaches the token's consumer feed (boot-key local)", async () => {
  // The test token is registered with userId=local / ownerId=owner_default. Pushing to a brand-new
  // PRIVATE lane must still surface in the `local` feed — the route subscribes the consumer id.
  await client.pushCard({ lane: "private-note", title: "only for me" }); // default visibility: private
  const titles = await drain("local");
  assert.ok(titles.includes("only for me"), "new private lane's card should reach the boot-key consumer feed");
});

test("push_card with a repeated dedupe_key upserts (deduped=true)", async () => {
  await client.createLane({ lane: "status", visibility: "public" });
  const a = await client.pushCard({ lane: "status", title: "v1", dedupe_key: "d" });
  const b = await client.pushCard({ lane: "status", title: "v2", dedupe_key: "d" });
  assert.equal(a.deduped, false);
  assert.equal(b.deduped, true);
});

test("push_card handles a non-slug lane name (slugified to match the stored lane)", async () => {
  const res = await client.pushCard({ lane: "Spanish Vocab", title: "buenos días" });
  assert.ok(res.id);
  assert.equal(res.lane, "spanish-vocab"); // canonical slug, and the push actually landed
  const lanes = await client.listLanes();
  assert.ok(lanes.some((l) => l.id === "spanish-vocab"));
});

// --- push_deck -------------------------------------------------------------
test("push_deck pushes every card; a subscriber receives them all", async () => {
  await client.createLane({ lane: "deck", visibility: "public" });
  const cards = [{ title: "card A" }, { title: "card B" }, { title: "card C" }];
  const out = await client.pushDeck({ lane: "deck", cards });
  assert.equal(out.count, 3);
  const titles = await drain("consumer-deck"); // other public lanes may interleave; that's fine
  for (const t of ["card A", "card B", "card C"]) assert.ok(titles.includes(t), `deck card missing: ${t}`);
});

test("push_deck recurring re-delivers each card up to max, then retires it", async () => {
  await client.createLane({ lane: "spanish", visibility: "public" });
  // One card, recurring with cooldown 0 and max 2 → delivered exactly twice across the session.
  await client.pushDeck({ lane: "spanish", cooldown_s: 0, max: 2, cards: [{ title: "hola = hello" }] });
  const titles = await drain("consumer-spanish");
  const count = titles.filter((t) => t === "hola = hello").length;
  assert.equal(count, 2); // recurring, cooldown 0, max 2 → exactly two deliveries
});
