// whileaway bus — HTTP API. Two surfaces:
//   • Producer (auth via publisher key): create channels, push items.
//   • Consumer (a user identity; open by default for local self-host): pull the feed, manage
//     subscriptions, browse the channel directory.
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as bus from "./bus.js";
import { bootstrap, LOCAL_USER } from "./bootstrap.js";
import { flush } from "./store.js";
import { startPushers } from "../clients/runner.js";
import { hit, LIMITS } from "./ratelimit.js";
import * as metrics from "./metrics.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

const PORT = process.env.PORT || 4000;
const AUTH_MODE = process.env.AUTH_MODE || "none"; // "none" (self-host) | "hosted"
if (!["none", "hosted"].includes(AUTH_MODE)) {
  // Fail closed: an unrecognized value (e.g. a typo like "HOSTED") must never silently degrade to
  // the header-trusting self-host path in what was meant to be a hosted deployment.
  console.error(`[whileaway] invalid AUTH_MODE="${AUTH_MODE}" — expected "none" or "hosted"`);
  process.exit(1);
}
let DEFAULT_KEY = null; // the boot publisher key, revealed only to loopback callers

function bearer(req) {
  const m = /^Bearer (.+)$/.exec(req.get("Authorization") || "");
  return m && m[1];
}

// Better Auth (hosted mode only). Its handler MUST be mounted before express.json — it reads the
// raw request body. Loaded dynamically so self-host (none) never pulls in better-auth or opens an
// auth DB. `session(req)` resolves the logged-in dashboard user, or null.
let auth = null, fromNodeHeaders = null;
if (AUTH_MODE === "hosted") {
  const [authMod, nodeMod] = await Promise.all([import("./auth.js"), import("better-auth/node")]);
  auth = authMod.auth;
  fromNodeHeaders = nodeMod.fromNodeHeaders;
  app.all("/api/auth/*", nodeMod.toNodeHandler(auth));
}
async function session(req) {
  if (!auth) return null;
  try { return (await auth.api.getSession({ headers: fromNodeHeaders(req.headers) })) || null; }
  catch { return null; }
}

app.use(express.json({ limit: "256kb" }));

// Admin web console (static). Served at / — drives the same /v1 API you'd use programmatically.
app.use(express.static(path.join(__dirname, "../public"), { extensions: ["html"] })); // /privacy → privacy.html

app.use((req, res, next) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Whileaway-User");
  res.set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

// Consumer identity. Clients send a stable random id via X-Whileaway-User so each browser gets
// its own subscriptions/feed/history on the shared bus (no login). Falls back to "local" for
// bare API calls. ensureUser seeds a brand-new id with the public channels on first contact.
// Consumer identity. A bearer token with read scope names the user (hosted); otherwise fall
// back to the X-Whileaway-User header (self-host, unchanged). ensureUser seeds a brand-new id
// with the public channels on first contact.
function user(req) {
  const u = bus.consumerIdentity({
    authMode: AUTH_MODE,
    token: bearer(req),
    headerUser: req.get("X-Whileaway-User") || req.query.user || LOCAL_USER,
  });
  bus.ensureUser(u);
  return u;
}

// Producer auth: a valid bearer token resolves to { userId, ownerId, scopes }. Producer routes
// read ownerId (routes then check channel ownership) and require a push/create scope.
function publisher(req, res, next) {
  const auth = bus.resolveToken(bearer(req));
  if (!auth) return res.status(401).json({ error: "invalid or missing publisher key" });
  if (!auth.scopes.some((s) => s.startsWith("push:") || s.startsWith("create:"))) {
    return res.status(403).json({ error: "token lacks producer scope" });
  }
  req.auth = auth;
  req.ownerId = auth.ownerId;
  next();
}

// Fixed-window rate limit → 429 + Retry-After. Sets the header before throwing so wrap()'s JSON
// error response carries it.
function enforceRate(res, key, maxPerMin) {
  const r = hit(key, maxPerMin, 60000);
  if (!r.allowed) {
    res.set("Retry-After", String(r.retryAfterS));
    const e = new Error("rate limit exceeded, retry in " + r.retryAfterS + "s"); e.status = 429; throw e;
  }
}

function wrap(fn) {
  return (req, res) => {
    try { const out = fn(req, res); if (out !== undefined) res.json(out); }
    catch (e) { res.status(e.status || 500).json({ error: e.message }); }
  };
}

// ---- health + client display config --------------------------------------
// Liveness probe: always 200 regardless of auth mode. Per-user stats are attached only when the
// caller resolves to an identity (never required — hosted health checks carry no token).
app.get("/health", (req, res) => {
  let stats = {};
  try { stats = bus.stats(user(req)); } catch { /* unauthenticated probe in hosted mode */ }
  res.json({ ok: true, ...stats });
});

// Loopback-only convenience: hands the local admin console the default publisher key so you
// don't have to copy it from the logs. Returns 403 to any non-loopback caller (e.g. on Fly),
// so the key never leaks publicly — there you paste it into the console by hand.
app.get("/v1/admin/hello", (req, res) => {
  const ip = req.socket.remoteAddress || "";
  const loopback = ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip);
  if (!loopback) return res.status(403).json({ error: "loopback only" });
  res.json({ base: `http://localhost:${PORT}`, key: DEFAULT_KEY });
});
// Public client-config probe. authMode lets the connect page decide whether to show sign-in
// (hosted) or go straight to the self-host view (none). No secrets here.
app.get("/v1/feed/config", (_req, res) => res.json({ ...bus.CONFIG, authMode: AUTH_MODE }));

// Activation & seen-rate funnel (T-63). Aggregate-only (no per-user rows), but the totals still
// reveal user/lane counts, so hosted mode requires a dedicated ops token (WHILEAWAY_METRICS_TOKEN)
// — NOT just any signed-up user's token, which would let anyone watch our growth. Fail closed if
// the ops token is unset. Self-host ("none") is a single trust domain and stays open.
app.get("/v1/metrics", (req, res) => {
  if (AUTH_MODE === "hosted") {
    const ops = process.env.WHILEAWAY_METRICS_TOKEN;
    if (!ops || bearer(req) !== ops) {
      return void res.status(401).json({ error: "metrics require the ops token" });
    }
  }
  res.json(metrics.snapshot());
});

// ---- consumer: feed ------------------------------------------------------
app.get("/v1/feed/next", wrap((req, res) => {
  const u = user(req);
  enforceRate(res, "pull:" + u, LIMITS.pullPerMin);
  const item = bus.next(u);
  if (!item) return void res.status(204).end();
  res.json(item);
}));
// Non-mutating preview of the next card — for UIs (extension popup) that want to show what's
// coming without consuming it. Never records a delivery.
app.get("/v1/feed/peek", wrap((req, res) => {
  const item = bus.peek(user(req));
  if (!item) return void res.status(204).end();
  res.json(item);
}));
app.post("/v1/feed/seen", wrap((req) => bus.markSeen(user(req), (req.body || {}).id || (req.body || {}).itemId)));
app.get("/v1/feed/history", wrap((req) => ({ cards: bus.history(user(req), Number(req.query.limit) || 50) })));

// ---- surface-agnostic: RSS/Atom out (T-53) -------------------------------
// A lane rendered as an Atom feed — proof the feed outlives our own clients. Public lanes serve
// anonymously (the "subscribe to it in any reader" demo); private/unlisted need a bearer token
// that can see the lane (header only — we never accept a token in the URL). Self-host is open.
function xmlEsc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function renderAtom(lane, cards, origin) {
  const self = `${origin}/v1/lanes/${encodeURIComponent(lane.id)}/feed.xml`;
  const updated = (cards[0] ? new Date(cards[0].createdAt) : new Date()).toISOString();
  const entries = cards.map((c) => {
    const link = c.url ? `<link href="${xmlEsc(c.url)}"/>` : "";
    const content = c.body ? `<content type="text">${xmlEsc(c.body)}</content>` : "";
    return `<entry><title>${xmlEsc(c.title)}</title><id>urn:whileaway:${xmlEsc(c.id)}</id><updated>${new Date(c.createdAt).toISOString()}</updated>${link}${content}</entry>`;
  }).join("");
  return `<?xml version="1.0" encoding="utf-8"?>\n<feed xmlns="http://www.w3.org/2005/Atom"><title>${xmlEsc(lane.title)}</title><id>urn:whileaway:lane:${xmlEsc(lane.id)}</id><link rel="self" href="${xmlEsc(self)}"/><updated>${updated}</updated>${entries}</feed>`;
}
app.get("/v1/lanes/:id/feed.xml", (req, res) => {
  const lane = bus.getLane(req.params.id);
  if (!lane) return void res.status(404).type("text/plain").send("no such lane");
  if (AUTH_MODE === "hosted" && lane.visibility !== "public") {
    const auth = bus.resolveToken(bearer(req));
    if (!bus.laneVisibleTo(auth ? auth.userId : "", lane.id, auth && auth.ownerId)) {
      return void res.status(401).type("text/plain").send("private lane — provide a bearer token that can see it");
    }
  }
  const origin = `${req.protocol}://${req.get("host")}`;
  res.type("application/atom+xml").send(renderAtom(lane, bus.laneCards(lane.id, 50), origin));
});

// ---- consumer: lanes + subscriptions (directory) -------------------------
app.get("/v1/lanes", wrap((req) => ({ lanes: bus.listLanes(user(req)) })));
app.post("/v1/subscriptions", wrap((req) => {
  const u = user(req); const { laneId, action } = req.body || {};
  if (action === "unsubscribe") return { lanes: bus.unsubscribe(u, laneId) };
  if (action === "mute") return { lanes: bus.setMuted(u, laneId, true) };
  if (action === "unmute") return { lanes: bus.setMuted(u, laneId, false) };
  return { lanes: bus.subscribe(u, laneId) };
}));

// ---- producer: lanes + card push -----------------------------------------
app.post("/v1/lanes", publisher, wrap((req) => {
  if (!bus.hasScope(req.auth.scopes, "create:lane")) {
    const e = new Error("token lacks create:lane scope"); e.status = 403; throw e;
  }
  const lane = bus.createLane(req.body || {}, req.ownerId); // auto-subscribes the owner
  // Also subscribe the token's CONSUMER identity when it differs from the owner (the self-host
  // boot key is userId=local / ownerId=owner_default), so the same token that creates a lane also
  // receives its cards in the feed.
  if (req.auth.userId && req.auth.userId !== req.ownerId) {
    bus.ensureUser(req.auth.userId); // seed public subs first (see createLane) — avoid a partial record
    bus.subscribe(req.auth.userId, lane.id, { force: true });
  }
  return { lane };
}));
app.get("/v1/lanes/:id", wrap((req) => {
  const notFound = () => { const e = new Error("not found"); e.status = 404; throw e; };
  // Hosted: authenticate BEFORE any lookup so unauth callers always get 401 (never a 404-vs-401
  // oracle that would let them enumerate private lane ids), then gate on visibility.
  if (AUTH_MODE === "hosted") {
    const u = user(req); // 401s without a valid read token
    const auth = bus.resolveToken(bearer(req)); // owner may differ from consumer userId
    if (!bus.laneVisibleTo(u, req.params.id, auth && auth.ownerId)) notFound();
  }
  // Self-host ("none") is a single trust domain — keep today's behavior (metadata by id).
  const c = bus.getLane(req.params.id);
  if (!c) notFound();
  return { lane: { id: c.id, title: c.title, description: c.description, accent: c.accent, kind: c.kind, visibility: c.visibility } };
}));
app.post("/v1/lanes/:id/cards", publisher, wrap((req, res) => {
  enforceRate(res, "push:" + bearer(req), LIMITS.pushPerMin);
  if (!bus.hasScope(req.auth.scopes, "push:lane/" + req.params.id)) {
    const e = new Error("token not scoped to push to this lane"); e.status = 403; throw e;
  }
  const { item: card, deduped } = bus.pushCard(req.params.id, req.body || {}, req.ownerId);
  return { id: card.id, deduped };
}));
// Convenience: mint an additional publisher key for the authenticated owner. The new key
// inherits the CALLER's scopes (never more) so a narrow lane-scoped token can't exchange itself
// for a wildcard god-token — no privilege escalation through minting.
app.post("/v1/keys", publisher, wrap((req) => ({
  key: bus.mintKey(req.ownerId, (req.body || {}).label || "", { userId: req.auth.userId, scopes: req.auth.scopes }),
})));

// ---- hosted: dashboard session endpoints ---------------------------------
// Identity, lanes, and token labels for the signed-in dashboard user (session cookie, not bearer).
app.get("/v1/me", async (req, res) => {
  const s = await session(req);
  if (!s || !s.user) return void res.status(401).json({ error: "not signed in" });
  const uid = s.user.id;
  bus.ensureOwner(uid, s.user.email || s.user.name || uid); // idempotent — signup hook already ran
  res.json({
    user: { id: uid, email: s.user.email, name: s.user.name },
    lanes: bus.listLanes(uid),
    tokens: bus.listKeys(uid),
  });
});
// Mint (or revoke) a bearer token for the signed-in user. Plaintext is returned exactly once.
app.post("/v1/tokens", async (req, res) => {
  const s = await session(req);
  if (!s || !s.user) return void res.status(401).json({ error: "not signed in" });
  const uid = s.user.id;
  const body = req.body || {};
  if (body.action === "revoke") return void res.json({ revoked: bus.revokeKey(uid, body.keyId) });
  bus.ensureOwner(uid, s.user.email || uid);
  const label = String(body.label || "token").slice(0, 40);
  const token = bus.mintKey(uid, label, { userId: uid }); // userId === ownerId for a hosted god-token
  metrics.bump("tokensMinted"); // funnel: signup → TOKEN → delivered → seen (T-63)
  res.json({ token, label }); // shown once; only the hash is persisted
});

// ---- boot ----------------------------------------------------------------
bus.init();
const { key } = bootstrap();
DEFAULT_KEY = key;
app.listen(PORT, () => {
  console.log(`[whileaway] bus on http://localhost:${PORT} (auth mode: ${AUTH_MODE})`);
  console.log(`[whileaway] default publisher key: ${key}${process.env.WHILEAWAY_KEY ? "" : "  (ephemeral — set WHILEAWAY_KEY to persist)"}`);
  if (process.env.RUN_DEFAULT_PUSHERS !== "0") {
    startPushers(`http://localhost:${PORT}`, key).catch((e) => console.warn("[whileaway] pushers:", e.message));
  }
});

// Flush debounced state before the machine stops (Fly sends SIGTERM on deploy/restart), so a
// mutation from the last 300ms isn't lost with the pending save timer.
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, () => { try { flush(); } finally { process.exit(0); } });
}
