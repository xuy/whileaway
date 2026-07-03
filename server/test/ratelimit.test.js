// Pins T-13: fixed-window rate limiting (429 + Retry-After) and hard per-owner caps (403).
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { hit, resetLimiter, LIMITS } from "../src/ratelimit.js";
import * as bus from "../src/bus.js";
import { reset } from "../src/store.js";

afterEach(() => resetLimiter());

test("hit() allows up to max within a window, then blocks with a Retry-After", () => {
  resetLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(hit("k", 3, 60000, t0).allowed, true);
  const blocked = hit("k", 3, 60000, t0 + 1000); // 4th within window
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterS >= 1 && blocked.retryAfterS <= 60);
});

test("hit() resets after the window elapses", () => {
  resetLimiter();
  const t0 = 2_000_000;
  assert.equal(hit("k", 1, 60000, t0).allowed, true);
  assert.equal(hit("k", 1, 60000, t0 + 100).allowed, false); // still in window
  assert.equal(hit("k", 1, 60000, t0 + 60001).allowed, true); // new window
});

test("separate keys have independent budgets", () => {
  resetLimiter();
  const t0 = 3_000_000;
  assert.equal(hit("a", 1, 60000, t0).allowed, true);
  assert.equal(hit("b", 1, 60000, t0).allowed, true); // different key, own budget
  assert.equal(hit("a", 1, 60000, t0).allowed, false);
});

test("lane cap: creating beyond maxLanesPerOwner is rejected (403)", () => {
  reset();
  const saved = LIMITS.maxLanesPerOwner;
  LIMITS.maxLanesPerOwner = 2;
  try {
    bus.ensureOwner("o1");
    bus.createChannel({ id: "l1" }, "o1");
    bus.createChannel({ id: "l2" }, "o1");
    assert.throws(() => bus.createChannel({ id: "l3" }, "o1"), (e) => e.status === 403 && /lane cap/.test(e.message));
    // Updating an EXISTING lane is not blocked by the cap.
    assert.doesNotThrow(() => bus.createChannel({ id: "l1", title: "renamed" }, "o1"));
  } finally { LIMITS.maxLanesPerOwner = saved; }
});

test("item cap: pushing beyond maxItemsPerOwner is rejected, but dedupe upsert is allowed", () => {
  reset();
  const saved = LIMITS.maxItemsPerOwner;
  LIMITS.maxItemsPerOwner = 2;
  try {
    bus.ensureOwner("o1");
    bus.createChannel({ id: "c1" }, "o1");
    bus.pushItem("c1", { title: "a" }, "o1");
    bus.pushItem("c1", { title: "b", dedupe_key: "k" }, "o1");
    assert.throws(() => bus.pushItem("c1", { title: "c" }, "o1"), (e) => e.status === 403 && /item cap/.test(e.message));
    // Re-pushing an existing dedupe_key upserts in place — allowed even at the cap.
    assert.doesNotThrow(() => bus.pushItem("c1", { title: "b2", dedupe_key: "k" }, "o1"));
  } finally { LIMITS.maxItemsPerOwner = saved; }
});
