// Pins the unified bearer-token model (T-10): one token → { userId, ownerId, scopes }, with
// userId and ownerId kept DISTINCT in the store (spec §3 rule 1). Consumer routes read userId;
// producer routes read ownerId + check scope.
import { test } from "node:test";
import assert from "node:assert/strict";
import * as bus from "../src/bus.js";
import { reset, db } from "../src/store.js";

test("resolveToken returns null for empty/unknown tokens", () => {
  reset();
  assert.equal(bus.resolveToken(null), null);
  assert.equal(bus.resolveToken(""), null);
  assert.equal(bus.resolveToken("vf_pk_nonexistent"), null);
});

test("minted token resolves to userId/ownerId/scopes; v0 pair coincides by default", () => {
  reset();
  const key = bus.mintKey("acct1", "god");
  const auth = bus.resolveToken(key);
  assert.equal(auth.ownerId, "acct1");
  assert.equal(auth.userId, "acct1"); // coincide in v0…
  assert.deepEqual(auth.scopes, bus.DEFAULT_SCOPES);
});

test("store keeps userId and ownerId as DISTINCT fields (rule 1: no merging)", () => {
  reset();
  const key = bus.mintKey("owner_default", "boot", { userId: "local" });
  const rec = db.keys[bus.hashKey(key)];
  assert.equal(rec.ownerId, "owner_default");
  assert.equal(rec.userId, "local"); // distinct — the two are not collapsed
  const auth = bus.resolveToken(key);
  assert.equal(auth.ownerId, "owner_default");
  assert.equal(auth.userId, "local");
});

test("hasScope: exact match, wildcard lane, and read scope", () => {
  const god = bus.DEFAULT_SCOPES; // ["push:lane/*", "read:feed"]
  assert.ok(bus.hasScope(god, "push:lane/anything"));
  assert.ok(bus.hasScope(god, "read:feed"));
  assert.ok(!bus.hasScope(god, "admin:everything"));
  assert.ok(bus.hasScope(["push:lane/spanish"], "push:lane/spanish"));
  assert.ok(!bus.hasScope(["push:lane/spanish"], "push:lane/other")); // narrow token can't cross lanes
  assert.ok(!bus.hasScope(["read:feed"], "push:lane/x")); // read-only can't push
});

test("minting inherits the caller's scopes — no privilege escalation (P1)", () => {
  reset();
  // A narrow, lane-scoped token mints a new key; the new key must NOT gain wildcard scopes.
  const narrow = ["push:lane/spanish"];
  const minted = bus.mintKey("acct1", "child", { userId: "acct1", scopes: narrow });
  assert.deepEqual(bus.resolveToken(minted).scopes, narrow);
  assert.ok(!bus.hasScope(bus.resolveToken(minted).scopes, "push:lane/other"));
  assert.ok(!bus.hasScope(bus.resolveToken(minted).scopes, "read:feed"));
});

test("setKeyIdentity backfills a legacy record missing userId/scopes (P2)", () => {
  reset();
  // Simulate a pre-T-10 persisted record: ownerId only, no userId/scopes.
  const key = "vf_pk_legacy";
  db.keys[bus.hashKey(key)] = { id: "key_legacy", ownerId: "owner_default", label: "env key" };
  bus.setKeyIdentity(key, { userId: "local" });
  const auth = bus.resolveToken(key);
  assert.equal(auth.userId, "local"); // now resolves to the seeded local feed, not owner_default
  assert.equal(auth.ownerId, "owner_default");
  assert.deepEqual(auth.scopes, bus.DEFAULT_SCOPES); // scopes filled with safe default
});

test("resolveToken tolerates a legacy record with no userId/scopes (runtime fallback)", () => {
  reset();
  const key = "vf_pk_legacy2";
  db.keys[bus.hashKey(key)] = { id: "key_legacy2", ownerId: "pub1", label: "old" };
  const auth = bus.resolveToken(key); // no migration run — pure fallback
  assert.equal(auth.userId, "pub1"); // userId := ownerId
  assert.deepEqual(auth.scopes, bus.DEFAULT_SCOPES);
});

test("hosted mode: consumer identity requires a read-scoped token, header is not trusted", () => {
  reset();
  const key = bus.mintKey("u1", "god"); // has read:feed
  // No token → reject (header spoofing blocked).
  assert.throws(
    () => bus.consumerIdentity({ authMode: "hosted", token: null, headerUser: "victim" }),
    (e) => e.status === 401,
  );
  // Token lacking read scope → also reject.
  const pushOnly = bus.mintKey("u2", "narrow", { userId: "u2", scopes: ["push:lane/x"] });
  assert.throws(
    () => bus.consumerIdentity({ authMode: "hosted", token: pushOnly, headerUser: "victim" }),
    (e) => e.status === 401,
  );
  // Valid read token → its userId, never the header.
  assert.equal(bus.consumerIdentity({ authMode: "hosted", token: key, headerUser: "victim" }), "u1");
});

test("self-host (none) mode: identity is the header, token never overrides it (byte-identical)", () => {
  reset();
  assert.equal(bus.consumerIdentity({ authMode: "none", token: null, headerUser: "browserA" }), "browserA");
  const key = bus.mintKey("u1", "god");
  // Even with a valid bearer token, the per-browser header identity is preserved — the token is
  // only a producer credential in self-host. This is what keeps existing per-browser state intact.
  assert.equal(bus.consumerIdentity({ authMode: "none", token: key, headerUser: "browserA" }), "browserA");
});

test("create:lane scope gates channel creation (push-only token cannot)", () => {
  assert.ok(bus.hasScope(bus.DEFAULT_SCOPES, "create:lane")); // god-token can
  assert.ok(!bus.hasScope(["push:lane/spanish"], "create:lane")); // delegated push token cannot
});

test("one token both pushes to an owned lane and pulls that user's feed", () => {
  reset();
  // Minted for account 'u1' where userId===ownerId (the hosted god-token shape).
  const key = bus.mintKey("u1", "god");
  const auth = bus.resolveToken(key);

  bus.ensureOwner("u1");
  bus.createLane({ id: "mylane", title: "Mine", visibility: "private" }, auth.ownerId); // auto-subscribes the owner

  // push (producer side: ownerId + scope) — addressed by bare slug within the owner's namespace
  assert.ok(bus.hasScope(auth.scopes, "push:lane/mylane"));
  bus.pushCard("mylane", { title: "from my agent" }, auth.ownerId);

  // pull (consumer side: userId)
  const item = bus.next(auth.userId);
  assert.equal(item.title, "from my agent");
});
