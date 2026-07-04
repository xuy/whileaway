// Pins the activation / seen-rate funnel (T-63): counters bump at the right event sites, the
// seen-rate is delivered→seen, and "seen" is counted once per (user,item) no matter how many
// times the client re-acks. Derived gauges are reconstructed from live delivery state.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as bus from "../src/bus.js";
import * as metrics from "../src/metrics.js";
import { reset } from "../src/store.js";

const OWNER = "owner_metrics";

function setup() {
  reset();
  bus.ensureOwner(OWNER, "metrics owner");
  bus.createChannel({ id: "m1", title: "M1", visibility: "public" }, OWNER);
  bus.ensureUser("u1");
  return "m1";
}

beforeEach(() => reset());

test("push bumps pushes; dedupe upsert does not double-count", () => {
  const c = setup();
  bus.pushItem(c, { title: "one", dedupe_key: "k" }, OWNER);
  assert.equal(metrics.counterValue("pushes"), 1);
  bus.pushItem(c, { title: "one v2", dedupe_key: "k" }, OWNER); // upsert, not a new item
  assert.equal(metrics.counterValue("pushes"), 1);
  bus.pushItem(c, { title: "two" }, OWNER);
  assert.equal(metrics.counterValue("pushes"), 2);
});

test("delivered and seen drive the headline seen-rate", () => {
  const c = setup();
  const { item } = bus.pushItem(c, { title: "hi" }, OWNER);

  // nothing delivered yet → no rate to report
  assert.equal(metrics.snapshot().seenRate, null);

  bus.next("u1"); // delivered = 1, seen = 0
  let s = metrics.snapshot();
  assert.equal(s.delivered, 1);
  assert.equal(s.seen, 0);
  assert.equal(s.seenRate, 0);
  assert.equal(s.activatedUsers, 1); // u1 has a delivery
  assert.equal(s.seenUsers, 0);

  bus.markSeen("u1", item.id); // seen = 1
  s = metrics.snapshot();
  assert.equal(s.seen, 1);
  assert.equal(s.seenRate, 1); // 1 delivered, 1 seen
  assert.equal(s.seenUsers, 1);

  // re-acking the same card must not inflate the numerator
  bus.markSeen("u1", item.id);
  assert.equal(metrics.snapshot().seen, 1);
});

test("seen-rate is a fraction across multiple deliveries", () => {
  reset();
  bus.ensureOwner(OWNER, "o");
  bus.createChannel({ id: "a", title: "A", visibility: "public" }, OWNER);
  bus.createChannel({ id: "b", title: "B", visibility: "public" }, OWNER);
  bus.ensureUser("u1");
  const a = bus.pushItem("a", { title: "a" }, OWNER).item;
  bus.pushItem("b", { title: "b" }, OWNER);

  bus.next("u1"); bus.next("u1"); // both delivered (round-robin)
  bus.markSeen("u1", a.id); // only one acked
  const s = metrics.snapshot();
  assert.equal(s.delivered, 2);
  assert.equal(s.seen, 1);
  assert.equal(s.seenRate, 0.5);
});

test("snapshot gauges reflect current state", () => {
  const c = setup();
  bus.pushItem(c, { title: "x" }, OWNER);
  const s = metrics.snapshot();
  assert.ok(s.lanes >= 1);
  assert.ok(s.items >= 1);
  assert.ok(s.owners >= 1);
});
