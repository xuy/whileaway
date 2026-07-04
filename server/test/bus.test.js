// Smoke tests that PIN the delivery-engine behaviors in bus.js before WS1 modifies it.
// Each test drives the bus through its public API exactly as the HTTP routes do. No disk I/O
// beyond the throwaway state file named by WHILEAWAY_STATE (see package.json test script); we
// never load() it — store.reset() gives every test a clean in-memory db.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as bus from "../src/bus.js";
import { reset, db } from "../src/store.js";

const OWNER = "owner_test";

// Owner + one channel + an auto-subscribed consumer. Public channels are auto-added to any new
// consumer by ensureUser, matching how a real browser id first hits the bus.
function setup({ visibility = "public", laneId = "c1" } = {}) {
  reset();
  bus.ensureOwner(OWNER, "test owner");
  bus.createLane({ id: laneId, title: laneId.toUpperCase(), visibility }, OWNER);
  bus.ensureUser("u1");
  return laneId;
}

function push(laneId, raw) {
  return bus.pushCard(laneId, raw, OWNER);
}

beforeEach(() => reset());

// --- the core loop: push → next → seen → history ---------------------------
test("ambient item: push → next delivers once → seen records history", () => {
  const c = setup();
  const { item } = push(c, { title: "Hello", body: "world" });

  const first = bus.next("u1");
  assert.equal(first.title, "Hello");
  assert.equal(first.id, item.id);

  // ambient shows a single time — the second pull yields nothing.
  assert.equal(bus.next("u1"), null);

  // seen moves it into history exactly once.
  bus.markSeen("u1", item.id);
  const h = bus.history("u1");
  assert.equal(h.length, 1);
  assert.equal(h[0].title, "Hello");

  // marking seen again does not duplicate the history entry.
  bus.markSeen("u1", item.id);
  assert.equal(bus.history("u1").length, 1);
});

// --- peek is non-mutating ---------------------------------------------------
test("peek previews the next card without consuming it", () => {
  const c = setup();
  push(c, { title: "Only card" });
  assert.equal(bus.peek("u1").title, "Only card");
  assert.equal(bus.peek("u1").title, "Only card"); // idempotent — no delivery recorded
  assert.equal(bus.next("u1").title, "Only card"); // still deliverable after peeking
  assert.equal(bus.next("u1"), null); // now consumed (ambient once)
});

// --- dedupe upsert ----------------------------------------------------------
test("dedupe_key upserts in place instead of creating a second item", () => {
  const c = setup();
  const a = push(c, { title: "v1", dedupe_key: "k" });
  assert.equal(a.deduped, false);

  const b = push(c, { title: "v2", body: "updated", dedupe_key: "k" });
  assert.equal(b.deduped, true);
  assert.equal(b.item.id, a.item.id); // same record
  assert.equal(b.item.title, "v2"); // content refreshed in place
  assert.equal(db.cardsByLane[bus.laneId(OWNER, c)].length, 1); // only one item ever stored (global id)
});

// --- must_see re-surfaces until acknowledged --------------------------------
test("must_see keeps surfacing until seen, then stops", () => {
  const c = setup();
  const { item } = push(c, { title: "Important", delivery: { class: "must_see" } });

  // delivered repeatedly while unseen (unlike ambient, which stops after one).
  assert.equal(bus.next("u1").id, item.id);
  assert.equal(bus.next("u1").id, item.id);

  bus.markSeen("u1", item.id);
  assert.equal(bus.next("u1"), null);
});

// --- recurring: cooldown gates, max caps ------------------------------------
test("recurring respects cooldown between deliveries", () => {
  const c = setup();
  push(c, { title: "Daily", delivery: { repeat: { mode: "recurring", cooldown_s: 3600 } } });

  assert.ok(bus.next("u1")); // first delivery
  assert.equal(bus.next("u1"), null); // within cooldown → blocked
});

test("recurring respects max delivery count", () => {
  const c = setup();
  push(c, { title: "Twice", delivery: { repeat: { mode: "recurring", cooldown_s: 0, max: 2 } } });

  assert.ok(bus.next("u1")); // 1
  assert.ok(bus.next("u1")); // 2
  assert.equal(bus.next("u1"), null); // hit max → done
});

// --- expiry -----------------------------------------------------------------
test("expired items are never delivered", () => {
  const c = setup();
  push(c, { title: "Stale", delivery: { expires_at: "2000-01-01T00:00:00.000Z" } });
  assert.equal(bus.next("u1"), null);
});

// --- round-robin fairness ---------------------------------------------------
test("consecutive deliveries prefer a different channel", () => {
  reset();
  bus.ensureOwner(OWNER, "test owner");
  bus.createLane({ id: "c1", title: "C1", visibility: "public" }, OWNER);
  bus.createLane({ id: "c2", title: "C2", visibility: "public" }, OWNER);
  bus.ensureUser("u1"); // auto-subscribed to both public channels
  push("c1", { title: "from c1" });
  push("c2", { title: "from c2" });

  const first = bus.next("u1");
  const second = bus.next("u1");
  assert.ok(first && second);
  assert.notEqual(first.laneId, second.laneId); // fairness: not the same lane twice
});

// --- private-channel guard (spec §3: lanes are private by default) ----------
test("a stranger cannot subscribe to someone else's private channel", () => {
  reset();
  bus.ensureOwner(OWNER, "test owner");
  const secret = bus.createLane({ id: "secret", title: "Secret", visibility: "private" }, OWNER);
  bus.ensureUser("stranger"); // gets no private channels
  assert.throws(() => bus.subscribe("stranger", secret.id), /private/);
});

// --- owner receives what they push to their own lane ------------------------
test("creating a lane auto-subscribes the owner so their pushes reach their feed", () => {
  reset();
  bus.ensureOwner("acct", "account");
  bus.createLane({ id: "spanish", title: "Spanish", visibility: "private" }, "acct");
  // No explicit subscribe — creation subscribed the owner. In hosted, userId === ownerId, so
  // "acct" is both producer and consumer and must see the card.
  bus.pushCard("spanish", { title: "hola" }, "acct");
  const item = bus.next("acct");
  assert.ok(item, "owner should receive a card pushed to a lane they just created");
  assert.equal(item.title, "hola");
});

test("creating a lane before first feed still seeds the owner's public subscriptions", () => {
  reset();
  bus.ensureOwner("sys", "system");
  bus.createLane({ id: "pub1", title: "Public", visibility: "public" }, "sys"); // a public lane exists
  bus.ensureOwner("acct", "account");
  bus.createLane({ id: "mylane", title: "Mine", visibility: "private" }, "acct"); // acct creates a lane FIRST
  const chans = bus.listLanes("acct");
  // Owner-subscribe must not have short-circuited public seeding:
  assert.ok(chans.some((c) => c.slug === "pub1" && c.subscribed), "public channel should still be seeded");
  assert.ok(chans.some((c) => c.slug === "mylane" && c.subscribed), "own new lane is subscribed");
});

// --- single-channel visibility (no metadata leak by id) ---------------------
test("laneVisibleTo: public to all, private only to owner or subscriber", () => {
  reset();
  bus.ensureOwner(OWNER, "test owner");
  const pub = bus.createLane({ id: "pub", title: "Pub", visibility: "public" }, OWNER);
  const priv = bus.createLane({ id: "priv", title: "Priv", visibility: "private" }, OWNER);
  bus.ensureUser("stranger");

  assert.ok(bus.laneVisibleTo("stranger", pub.id)); // public → visible
  assert.ok(!bus.laneVisibleTo("stranger", priv.id)); // private → hidden from stranger
  assert.ok(bus.laneVisibleTo(OWNER, priv.id)); // owner → visible
  assert.ok(!bus.laneVisibleTo("stranger", bus.laneId(OWNER, "nope"))); // missing → not visible (no leak)

  bus.subscribe(OWNER, priv.id); // owner subscribes; a subscriber can see it too
  assert.ok(bus.laneVisibleTo(OWNER, priv.id));
});

test("laneVisibleTo: owner sees own lane via ownerId even when consumer userId differs", () => {
  reset();
  bus.ensureOwner("acct_owner", "owner");
  const lane = bus.createLane({ id: "lane", title: "Lane", visibility: "private" }, "acct_owner");
  // A token whose consumer userId ("consumerX") differs from its ownerId ("acct_owner") — the
  // owner must still see the lane it owns, even though consumerX never subscribed.
  assert.ok(!bus.laneVisibleTo("consumerX", lane.id)); // no ownerId passed → hidden
  assert.ok(bus.laneVisibleTo("consumerX", lane.id, "acct_owner")); // ownerId matches → visible
});

// --- per-owner namespacing (T-15) -------------------------------------------
test("two owners can each hold a same-named lane without colliding", () => {
  reset();
  bus.ensureOwner("alice"); bus.ensureOwner("bob");
  const a = bus.createLane({ id: "spanish", title: "Alice's Spanish", visibility: "private" }, "alice");
  const b = bus.createLane({ id: "spanish", title: "Bob's Spanish", visibility: "private" }, "bob");
  assert.notEqual(a.id, b.id); // distinct global ids: alice:spanish vs bob:spanish
  assert.equal(a.slug, "spanish"); assert.equal(b.slug, "spanish");

  bus.pushCard("spanish", { title: "hola from alice" }, "alice");
  bus.pushCard("spanish", { title: "hola from bob" }, "bob");

  assert.equal(bus.next("alice").title, "hola from alice"); // each owner sees only their own lane
  assert.equal(bus.next("bob").title, "hola from bob");
});

// --- RSS/Atom out: laneCards (T-53) -----------------------------------------
test("laneCards returns a lane's cards newest-first and drops expired ones", () => {
  const c = setup(); // lane "c1"
  push(c, { title: "old" });
  push(c, { title: "new" });
  push(c, { title: "stale", delivery: { expires_at: "2000-01-01T00:00:00.000Z" } });
  const cards = bus.laneCards(bus.laneId(OWNER, c));
  assert.equal(cards.length, 2); // expired "stale" dropped
  assert.equal(cards[0].title, "new"); // newest first
  assert.equal(cards[1].title, "old");
  assert.equal(bus.laneCards("nobody:nolane").length, 0); // unknown lane → empty
});

// --- ownership guard on push ------------------------------------------------
test("you cannot push into another owner's lane — refs resolve within your own namespace", () => {
  const c = setup(); // lane "c1" owned by OWNER
  // A different owner pushing "c1" resolves to `owner_other:c1`, which doesn't exist — so there's
  // no way to even address someone else's lane (stronger than the old cross-owner 403).
  assert.throws(() => bus.pushCard(c, { title: "nope" }, "owner_other"), /no such lane/);
  // And OWNER's lane is untouched.
  assert.equal((db.cardsByLane[bus.laneId(OWNER, c)] || []).length, 0);
});
