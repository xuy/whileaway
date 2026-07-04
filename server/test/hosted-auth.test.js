// Integration test for hosted mode (T-12): magic-link signup → session → /v1/me → mint token →
// push. Migrates Better Auth's schema, then boots the bus in AUTH_MODE=hosted as a child process.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SERVER_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4191;
const BASE = `http://localhost:${PORT}`;
const AUTH_DB = path.join(os.tmpdir(), `wa-hosted-auth-${process.pid}.db`);
const STATE = path.join(os.tmpdir(), `wa-hosted-state-${process.pid}.json`);
const SINK = path.join(os.tmpdir(), `wa-hosted-magic-${process.pid}.log`);
const ENV = {
  ...process.env,
  PORT: String(PORT), AUTH_MODE: "hosted",
  WHILEAWAY_AUTH_DB: AUTH_DB, WHILEAWAY_STATE: STATE, WHILEAWAY_MAGIC_SINK: SINK,
  WHILEAWAY_URL: BASE, WHILEAWAY_AUTH_SECRET: "test-secret-0123456789abcdef", WHILEAWAY_KEY: "wa_boot",
  RUN_DEFAULT_PUSHERS: "0",
};
let proc;

async function waitForHealth(tries = 60) {
  for (let i = 0; i < tries; i++) {
    try { if ((await fetch(BASE + "/health")).ok) return; } catch { /* not up */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("hosted bus did not become healthy");
}

// Run the magic-link flow, returning the session cookie for `email`.
async function signIn(email) {
  const before = fs.existsSync(SINK) ? fs.readFileSync(SINK, "utf8") : "";
  const send = await fetch(BASE + "/api/auth/sign-in/magic-link", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email }),
  });
  assert.equal(send.status, 200, "magic-link send should succeed");
  const line = fs.readFileSync(SINK, "utf8").slice(before.length).trim().split("\n").pop();
  const { url } = JSON.parse(line);
  const verify = await fetch(url, { redirect: "manual" });
  const setCookie = verify.headers.get("set-cookie");
  assert.ok(setCookie, "verify should set a session cookie");
  return setCookie.split(";")[0]; // name=value
}

before(async () => {
  for (const f of [AUTH_DB, STATE, SINK]) { try { fs.unlinkSync(f); } catch { /* fresh */ } }
  execSync("npm run auth:migrate", { cwd: SERVER_DIR, env: ENV, stdio: "ignore" });
  proc = spawn("node", ["src/index.js"], { cwd: SERVER_DIR, env: ENV, stdio: "ignore" });
  await waitForHealth();
});
after(() => {
  if (proc) proc.kill();
  for (const f of [AUTH_DB, STATE, SINK]) for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(f + ext); } catch { /* ignore */ } }
});

test("signup provisions a Personal lane + starter subscriptions, shown by /v1/me", async () => {
  const cookie = await signIn("alice@test.com");
  const me = await (await fetch(BASE + "/v1/me", { headers: { Cookie: cookie } })).json();
  assert.equal(me.user.email, "alice@test.com");
  const slugs = me.lanes.map((l) => l.slug);
  assert.ok(slugs.includes("personal"), "Personal lane provisioned");
  assert.ok(slugs.includes("wikipedia"), "starter channels seeded");
  assert.equal(me.tokens.length, 0, "no tokens until one is minted");
});

test("mint a token via POST /v1/tokens, then push with it", async () => {
  const cookie = await signIn("bob@test.com");
  const minted = await (await fetch(BASE + "/v1/tokens", {
    method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ label: "cli" }),
  })).json();
  assert.ok(minted.token && minted.token.startsWith("vf_pk_"), "returns a plaintext token once");

  const push = await fetch(BASE + "/v1/lanes/personal/cards", {
    method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + minted.token }, body: JSON.stringify({ title: "hi" }),
  });
  assert.equal(push.status, 200, "the minted token can push to the user's own lane");

  // the token now shows up (by label) in /v1/me
  const me = await (await fetch(BASE + "/v1/me", { headers: { Cookie: cookie } })).json();
  assert.ok(me.tokens.some((t) => t.label === "cli"));
});

test("session endpoints reject when not signed in", async () => {
  assert.equal((await fetch(BASE + "/v1/me")).status, 401);
  assert.equal((await fetch(BASE + "/v1/tokens", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
});

test("two users each get their own isolated Personal lane (per-owner scoping)", async () => {
  const ca = await signIn("carol@test.com");
  const cd = await signIn("dave@test.com");
  const meA = await (await fetch(BASE + "/v1/me", { headers: { Cookie: ca } })).json();
  const meD = await (await fetch(BASE + "/v1/me", { headers: { Cookie: cd } })).json();
  const laneA = meA.lanes.find((l) => l.slug === "personal");
  const laneD = meD.lanes.find((l) => l.slug === "personal");
  assert.ok(laneA && laneD);
  assert.notEqual(laneA.id, laneD.id, "each user's Personal lane has a distinct global id");
});
