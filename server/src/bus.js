// The bus: lanes, card push (with delivery semantics), subscriptions, and the delivery
// engine that decides the single best card to show a consumer right now. No external content
// is fetched here — cards only ever arrive by being PUSHED to a lane. The default content
// you see exists because we own those lanes and run reference pushers against this same API.
import crypto from "node:crypto";
import {
  db, save, load, deliveryKey, getSubs, pushCardRecord, findByDedupe, addHistory,
} from "./store.js";
import { LIMITS } from "./ratelimit.js";
import { bump } from "./metrics.js";

// Display/delivery timings handed to the consumer client (not the per-item semantics).
export const CONFIG = { cooldownMs: 20000, minVisibleMs: 1500, displayMs: 11000 };

const KINDS = new Set(["article", "discussion", "calendar", "email", "note", "event"]);
const CLASSES = new Set(["ambient", "must_see"]);

// --- keys / auth -----------------------------------------------------------
export function hashKey(key) {
  return crypto.createHash("sha256").update(String(key)).digest("hex");
}
export function ownerForKey(key) {
  if (!key) return null;
  const rec = db.keys[hashKey(key)];
  return rec ? rec.ownerId : null;
}
export function ensureOwner(ownerId, label) {
  if (!db.owners[ownerId]) { db.owners[ownerId] = { id: ownerId, label: label || ownerId }; save(); }
  return db.owners[ownerId];
}
// v0 god-token grant: create lanes, push to any owned lane, and read the feed. Teams (spec §3
// rule 3) are just new scope combinations on the same model, not a new auth system.
export const DEFAULT_SCOPES = ["create:lane", "push:lane/*", "read:feed"];

// A key record carries a DISTINCT (userId, ownerId) pair (spec §3 rule 1 — the two happen to
// coincide in v0 but are never merged in the data layer) plus its granted scopes.
export function registerKey(key, ownerId, label, opts = {}) {
  db.keys[hashKey(key)] = {
    id: "key_" + crypto.randomUUID().slice(0, 8),
    ownerId,
    userId: opts.userId || ownerId,
    scopes: opts.scopes || DEFAULT_SCOPES,
    label: label || "",
    createdAt: new Date().toISOString(),
  };
  save();
}
export function mintKey(ownerId, label, opts = {}) {
  const key = "vf_pk_" + crypto.randomBytes(18).toString("hex");
  registerKey(key, ownerId, label, opts);
  return key; // plaintext returned once; only the hash is persisted
}

// A token owner's keys, minus any secret material (no plaintext, no hash) — for the dashboard.
export function listKeys(ownerId) {
  return Object.values(db.keys)
    .filter((rec) => rec.ownerId === ownerId)
    .map((rec) => ({ id: rec.id, label: rec.label, scopes: rec.scopes, createdAt: rec.createdAt }));
}
// Revoke one of the owner's keys by its public id. Returns true if a key was removed.
export function revokeKey(ownerId, keyId) {
  for (const [hash, rec] of Object.entries(db.keys)) {
    if (rec.id === keyId && rec.ownerId === ownerId) { delete db.keys[hash]; save(); return true; }
  }
  return false;
}

// Unified token resolution: one bearer token → { userId, ownerId, scopes }. Consumer routes
// read userId; producer routes read ownerId and check scope. Returns null for empty/unknown.
export function resolveToken(token) {
  if (!token) return null;
  const rec = db.keys[hashKey(token)];
  if (!rec) return null;
  return { userId: rec.userId || rec.ownerId, ownerId: rec.ownerId, scopes: rec.scopes || DEFAULT_SCOPES };
}

// Resolve the consumer identity for a request.
//   • hosted: identity comes ONLY from a read-scoped bearer token — the X-Whileaway-User header
//     is untrusted (it would let anyone impersonate another user). Missing/unscoped → 401.
//   • none (self-host): identity is the stable per-browser header, exactly as before T-10. A
//     bearer token here is a PRODUCER credential only and must not change consumer identity —
//     the extension sends both headers whenever a token is set, and per-browser feed/subs/history
//     must stay intact.
export function consumerIdentity({ authMode, token, headerUser }) {
  if (authMode === "hosted") {
    const auth = resolveToken(token);
    if (!auth || !hasScope(auth.scopes, "read:feed")) throw httpErr(401, "authentication required");
    return auth.userId;
  }
  return headerUser;
}

function scopeMatches(granted, needed) {
  if (granted === needed) return true;
  if (granted.endsWith("/*")) return needed.startsWith(granted.slice(0, -1)); // "push:lane/*" ⊇ "push:lane/x"
  return false;
}
export function hasScope(scopes, needed) {
  return (scopes || []).some((s) => scopeMatches(s, needed));
}

// Backfill/repair a key record's identity in place. Used to upgrade a pre-T-10 boot key (which
// has no userId) to the correct consumer identity without re-minting it.
export function setKeyIdentity(key, { userId, scopes } = {}) {
  const rec = db.keys[hashKey(key)];
  if (!rec) return;
  if (userId != null) rec.userId = userId;
  if (scopes != null) rec.scopes = scopes;
  if (rec.scopes == null) rec.scopes = DEFAULT_SCOPES;
  save();
}

// --- lanes -----------------------------------------------------------------
// Lanes are namespaced PER OWNER: the stored global id is `${ownerId}:${slug}` (see the namespace
// model — a flat handle namespace sits on top later, owner-scoped slugs underneath). So two owners
// can each hold a `personal`/`spanish` lane without colliding, and producers address their own
// lanes by bare slug.
export function laneId(ownerId, ref) { return ownerId + ":" + slugify(ref); }

export function createLane(spec, ownerId) {
  const slug = slugify(spec.id || spec.slug || spec.title);
  if (!slug) throw httpErr(400, "lane needs a title or slug");
  const id = ownerId + ":" + slug;
  const existing = db.lanes[id];
  if (existing) {
    Object.assign(existing, pick(spec, ["title", "description", "icon", "accent", "kind", "visibility"]));
    save();
    return existing;
  }
  if (countLanes(ownerId) >= LIMITS.maxLanesPerOwner) {
    throw httpErr(403, `lane cap reached (max ${LIMITS.maxLanesPerOwner} per owner)`);
  }
  const ch = {
    id,
    slug,
    title: str(spec.title || slug, 80),
    description: str(spec.description || "", 280),
    icon: str(spec.icon || "", 8),
    accent: /^#[0-9a-fA-F]{6}$/.test(spec.accent || "") ? spec.accent : "#3a86ff",
    kind: KINDS.has(spec.kind) ? spec.kind : "note",
    ownerId,
    visibility: ["private", "unlisted", "public"].includes(spec.visibility) ? spec.visibility : "private",
    createdAt: new Date().toISOString(),
  };
  db.lanes[id] = ch;
  // Seed the owner's public/default subscriptions FIRST (ensureUser no-ops if they already have a
  // subs record). Doing this before the force-subscribe below avoids creating a partial subs
  // record that would make a later ensureUser() early-return and skip public-channel seeding.
  ensureUser(ownerId);
  // Auto-subscribe the owner to their new lane. Delivery only serves SUBSCRIBED channels, so
  // without this a card pushed to a freshly-created lane would never reach the owner's feed
  // (in hosted mode userId === ownerId, so this is exactly "you receive what you push here").
  subscribe(ownerId, id, { force: true });
  save();
  return ch;
}

export function getLane(id) { return db.lanes[id] || null; }

// Is this lane visible to this requester? Public lanes are visible to everyone; private/
// unlisted ones only to the owner or a subscriber. `ownerId` is the requesting token's owner —
// passed separately because a token's (userId, ownerId) can legitimately differ (spec §3 rule 1),
// and the owner must see their own lane even when its consumer userId isn't subscribed.
export function laneVisibleTo(userId, id, ownerId = null) {
  const c = db.lanes[id];
  if (!c) return false;
  if (c.visibility === "public") return true;
  if (c.ownerId === userId || (ownerId && c.ownerId === ownerId)) return true;
  return !!getSubs(userId)[id];
}

// Lanes visible to a user: public ones, plus any they own or are subscribed to.
export function listLanes(userId) {
  const subs = getSubs(userId);
  return Object.values(db.lanes)
    .filter((c) => c.visibility === "public" || c.ownerId === userId || subs[c.id])
    .map((c) => ({
      id: c.id, slug: c.slug, title: c.title, description: c.description, icon: c.icon, accent: c.accent,
      kind: c.kind, visibility: c.visibility, owned: c.ownerId === userId,
      subscribed: !!subs[c.id], muted: !!(subs[c.id] && subs[c.id].muted),
    }));
}

// --- cards / push ----------------------------------------------------------
// `ref` is an owner-scoped slug (or lane name); it resolves within the caller's own namespace, so
// ownership holds by construction — you can only ever push to your own lanes.
export function pushCard(ref, raw, ownerId) {
  const lid = ownerId + ":" + slugify(ref);
  const ch = db.lanes[lid];
  if (!ch) throw httpErr(404, "no such lane");
  const item = normalizeCard(raw, ch);

  const dup = findByDedupe(lid, item.dedupeKey);
  if (dup) {
    // Upsert: refresh content in place, keep id/createdAt and existing delivery state so a
    // re-push of something already seen doesn't nag the consumer again.
    Object.assign(dup, pick(item, ["title", "body", "url", "imageUrl", "kind", "priority", "class", "expiresAt", "repeat"]));
    save();
    return { item: dup, deduped: true }; // upsert doesn't add a new item, so it never hits the cap
  }
  if (countCards(ownerId) >= LIMITS.maxCardsPerOwner) {
    throw httpErr(403, `card cap reached (max ${LIMITS.maxCardsPerOwner} per owner)`);
  }
  pushCardRecord(item);
  bump("pushes"); // new items only; dedupe upserts returned above (T-63)
  return { item, deduped: false };
}

function normalizeCard(raw, ch) {
  if (!raw || typeof raw !== "object" || !str(raw.title, 1)) throw httpErr(400, "card needs a title");
  const d = raw.delivery || {};
  return {
    id: "card_" + crypto.randomUUID(),
    laneId: ch.id,
    title: str(raw.title, 300),
    body: str(raw.body || "", 1000),
    url: safeUrl(raw.url),
    imageUrl: safeUrl(raw.image_url || raw.imageUrl),
    kind: KINDS.has(raw.kind) ? raw.kind : ch.kind,
    dedupeKey: raw.dedupe_key || raw.dedupeKey || null,
    priority: clamp(num(d.priority, 50), 0, 100),
    class: CLASSES.has(d.class) ? d.class : "ambient",
    expiresAt: safeDate(d.expires_at || d.expiresAt),
    repeat: normalizeRepeat(d.repeat),
    createdAt: new Date().toISOString(),
  };
}
function normalizeRepeat(r) {
  if (!r || r.mode !== "recurring") return { mode: "once" };
  return { mode: "recurring", cooldownS: Math.max(0, num(r.cooldown_s ?? r.cooldownS, 86400)), max: r.max != null ? Math.max(1, num(r.max, 1)) : null };
}

// --- users -----------------------------------------------------------------
// First time we see a consumer id, give them their own subscription set seeded with the PUBLIC
// lanes so their feed isn't empty. Private lanes are never auto-added. Idempotent: once a
// user has a subscription record (even after unsubscribing from everything), we leave it alone.
export function ensureUser(userId) {
  if (db.subs[userId]) return;
  db.subs[userId] = {};
  for (const c of Object.values(db.lanes)) {
    if (c.visibility === "public") db.subs[userId][c.id] = { muted: false, createdAt: new Date().toISOString() };
  }
  save();
}

// --- subscriptions ---------------------------------------------------------
export function subscribe(userId, laneId, opts = {}) {
  const ch = db.lanes[laneId];
  if (!ch) throw httpErr(404, "no such lane");
  // You may subscribe to public/unlisted lanes, or private ones you own. `force` is for
  // internal seeding (bootstrap) only — the HTTP route never sets it, so a stranger can't join
  // someone else's private lane.
  if (!opts.force && ch.visibility === "private" && ch.ownerId !== userId) {
    throw httpErr(403, "cannot subscribe to a private lane");
  }
  const subs = getSubs(userId);
  if (!subs[laneId]) subs[laneId] = { muted: false, createdAt: new Date().toISOString() };
  save();
  return listLanes(userId);
}
export function unsubscribe(userId, laneId) {
  delete getSubs(userId)[laneId];
  save();
  return listLanes(userId);
}
export function setMuted(userId, laneId, muted) {
  const subs = getSubs(userId);
  if (subs[laneId]) { subs[laneId].muted = !!muted; save(); }
  return listLanes(userId);
}

// --- delivery engine -------------------------------------------------------
// Choose the single best eligible card for this user right now, WITHOUT mutating any state.
// `next()` records delivery on top of this; `peek()` is the read-only preview.
function selectNext(userId, now) {
  const subs = getSubs(userId);
  const eligible = [];
  for (const [laneId, sub] of Object.entries(subs)) {
    if (sub.muted) continue;
    const list = db.cardsByLane[laneId] || [];
    for (const id of list) {
      const it = db.cards[id];
      if (!it) continue;
      if (it.expiresAt && new Date(it.expiresAt).getTime() < now) continue; // expired → drop
      const st = db.delivery[deliveryKey(userId, id)];
      if (!isEligible(it, st, now)) continue;
      eligible.push(it);
    }
  }
  if (!eligible.length) return null;

  // Rank: must_see first, then priority, then newest.
  eligible.sort((a, b) =>
    (b.class === "must_see") - (a.class === "must_see") ||
    b.priority - a.priority ||
    new Date(b.createdAt) - new Date(a.createdAt));

  // Round-robin fairness: avoid serving the same lane twice in a row when alternatives exist.
  const last = db.cursor[userId] && db.cursor[userId].lastLaneId;
  return eligible.find((it) => it.laneId !== last) || eligible[0];
}

// Read-only: the card next() WOULD deliver, without consuming it. Used for the extension's
// preview so simply opening the popup never burns a one-shot ambient card.
export function peek(userId) {
  const chosen = selectNext(userId, Date.now());
  return chosen ? decorate(chosen) : null;
}

// Deliver the single best eligible card and record the delivery (mutates state).
export function next(userId) {
  const now = Date.now();
  const chosen = selectNext(userId, now);
  if (!chosen) return null;
  const dk = deliveryKey(userId, chosen.id);
  const st = db.delivery[dk] || (db.delivery[dk] = { deliveredCount: 0, lastDeliveredAt: null, seenAt: null });
  st.deliveredCount++;
  st.lastDeliveredAt = new Date().toISOString();
  (db.cursor[userId] || (db.cursor[userId] = {})).lastLaneId = chosen.laneId;
  save();
  bump("deliveries"); // total impressions; the seen-rate denominator is derived per-card (T-63)
  return decorate(chosen);
}

function isEligible(it, st, now) {
  if (!st || st.deliveredCount === 0) return true; // never delivered
  if (it.repeat.mode === "recurring") {
    // recurring: respect max + cooldown, regardless of seen state
    if (it.repeat.max != null && st.deliveredCount >= it.repeat.max) return false;
    const last = st.lastDeliveredAt ? new Date(st.lastDeliveredAt).getTime() : 0;
    return now - last >= it.repeat.cooldownS * 1000;
  }
  // once: ambient shows a single time; must_see keeps surfacing until acknowledged (seen) —
  // "important" without being an interruptive notification.
  if (it.class === "must_see" && !st.seenAt) return true;
  return false;
}

export function markSeen(userId, cardId) {
  const it = db.cards[cardId];
  const dk = deliveryKey(userId, cardId);
  const st = db.delivery[dk] || (db.delivery[dk] = { deliveredCount: 1, lastDeliveredAt: new Date().toISOString(), seenAt: null });
  if (!st.seenAt) {
    st.seenAt = new Date().toISOString();
    if (it) addHistory(userId, decorate(it));
    // seen-rate numerator is derived from st.seenAt in metrics.snapshot() — no counter to keep.
  }
  save();
  return { ok: true };
}

export function history(userId, limit = 50) {
  return (db.history[userId] || []).slice(0, limit);
}

// A lane's cards, newest first — for surface-agnostic renders like RSS/Atom out (T-53). Expired
// cards are dropped (they're not deliverable anywhere). Does not touch delivery state.
export function laneCards(id, limit = 50) {
  const ids = db.cardsByLane[id] || [];
  const now = Date.now();
  const out = [];
  for (let i = ids.length - 1; i >= 0 && out.length < limit; i--) {
    const c = db.cards[ids[i]];
    if (!c) continue;
    if (c.expiresAt && new Date(c.expiresAt).getTime() < now) continue;
    out.push(c);
  }
  return out;
}

// Attach lane display info (label/accent) so the client doesn't need a second lookup.
function decorate(it) {
  const ch = db.lanes[it.laneId] || {};
  return {
    id: it.id, laneId: it.laneId,
    sourceLabel: ch.title || it.laneId, accent: ch.accent || "#3a86ff",
    kind: it.kind, title: it.title, body: it.body, url: it.url, imageUrl: it.imageUrl,
    class: it.class, ts: it.createdAt,
  };
}

// --- caps (T-13) -----------------------------------------------------------
export function countLanes(ownerId) {
  let n = 0;
  for (const c of Object.values(db.lanes)) if (c.ownerId === ownerId) n++;
  return n;
}
export function countCards(ownerId) {
  let n = 0;
  for (const it of Object.values(db.cards)) {
    const ch = db.lanes[it.laneId];
    if (ch && ch.ownerId === ownerId) n++;
  }
  return n;
}

export function stats(userId) {
  const subs = getSubs(userId);
  return {
    lanes: Object.keys(db.lanes).length,
    cards: Object.keys(db.cards).length,
    subscriptions: Object.keys(subs).length,
    history: (db.history[userId] || []).length,
  };
}

export function init() {
  load();
  // Migrate pre-T-10 key records that predate userId/scopes so resolveToken never yields
  // undefined fields. Boot key gets a targeted LOCAL_USER backfill in bootstrap; here we only
  // fill in safe defaults (userId := ownerId) for any other legacy keys.
  let changed = false;
  for (const rec of Object.values(db.keys)) {
    if (rec.userId == null) { rec.userId = rec.ownerId; changed = true; }
    if (rec.scopes == null) { rec.scopes = DEFAULT_SCOPES; changed = true; }
  }
  if (changed) save();
}

// --- tiny utils ------------------------------------------------------------
function slugify(s) { return String(s || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48); }
function str(s, max) { s = s == null ? "" : String(s); return max === 1 ? (s.trim() ? s : "") : s.slice(0, max); }
function num(v, dflt) { const n = Number(v); return Number.isFinite(n) ? n : dflt; }
function clamp(n, lo, hi) { return Math.min(hi, Math.max(lo, n)); }
function safeUrl(u) { return typeof u === "string" && /^https?:\/\//i.test(u) ? u.slice(0, 2000) : null; }
function safeDate(s) { if (!s) return null; const d = new Date(s); return isNaN(d) ? null : d.toISOString(); }
function pick(o, keys) { const r = {}; for (const k of keys) if (o[k] !== undefined) r[k] = o[k]; return r; }
function httpErr(status, msg) { const e = new Error(msg); e.status = status; return e; }
