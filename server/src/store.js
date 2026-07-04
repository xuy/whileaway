// In-memory working set with pluggable persistence. The `db` shape is what matters; the actual
// load/save is delegated to a storage DRIVER selected by WHILEAWAY_STORE (json = self-host
// default; sqlite lands in T-11). Everything the bus needs lives here: owners, publisher keys
// (hashed), lanes, cards, per-user subscriptions, per-user delivery state, per-user history.
import { JsonDriver } from "./drivers/json.js";
import { SqliteDriver } from "./drivers/sqlite.js";

// Select the storage driver. Explicit and fail-loud on an unknown value.
function selectDriver() {
  const kind = process.env.WHILEAWAY_STORE || "json";
  switch (kind) {
    case "json": return new JsonDriver();
    case "sqlite": return new SqliteDriver();
    default: throw new Error(`unknown WHILEAWAY_STORE="${kind}" (expected "json" or "sqlite")`);
  }
}
const driver = selectDriver();

export const db = {
  owners: {}, // ownerId -> { id, label }
  keys: {}, // sha256(key) -> { id, ownerId, label, createdAt }
  lanes: {}, // laneId (ownerId:slug) -> { id, slug, title, description, icon, accent, kind, ownerId, visibility, createdAt }
  cards: {}, // cardId -> card (see bus.normalizeCard)
  cardsByLane: {}, // laneId -> [cardId, ...] (newest last)
  subs: {}, // userId -> { laneId -> { muted, createdAt } }
  delivery: {}, // `${userId}|${cardId}` -> { deliveredCount, lastDeliveredAt, seenAt }
  history: {}, // userId -> [ {card snapshot, seenAt}, ... ] newest first
  cursor: {}, // userId -> { lastLaneId }  (for round-robin fairness)
  metrics: {}, // counterName -> integer (activation/seen-rate counters, T-63)
};

const MAX_CARDS_PER_LANE = 250;
const MAX_HISTORY = 200;

export function load() {
  const raw = driver.load() || {};
  for (const k of Object.keys(db)) if (raw[k]) db[k] = raw[k];
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => driver.save(db), 300);
}

// Force a synchronous write of the current state, cancelling any pending debounce. Call this on
// process shutdown (SIGTERM/SIGINT) so a mutation made in the last 300ms before Fly stops the
// machine (e.g. a signup's owner/lane/subs) isn't lost with the debounce timer.
export function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  try { driver.save(db); } catch (e) { console.warn("[whileaway] flush failed:", e.message); }
}

// Test-only: wipe all in-memory collections and cancel any pending write so each test starts
// from a clean db without touching the on-disk state file. Not used by the running server.
export function reset() {
  clearTimeout(saveTimer);
  for (const k of Object.keys(db)) db[k] = {};
}

// --- helpers ---------------------------------------------------------------
export function deliveryKey(userId, itemId) {
  return userId + "|" + itemId;
}

export function getSubs(userId) {
  return db.subs[userId] || (db.subs[userId] = {});
}

export function pushCardRecord(item) {
  db.cards[item.id] = item;
  const list = db.cardsByLane[item.laneId] || (db.cardsByLane[item.laneId] = []);
  if (!list.includes(item.id)) list.push(item.id);
  // trim oldest, dropping their item records + delivery state would be ideal; keep simple: cap list.
  if (list.length > MAX_CARDS_PER_LANE) {
    const dropped = list.splice(0, list.length - MAX_CARDS_PER_LANE);
    for (const id of dropped) delete db.cards[id];
  }
  save();
}

export function findByDedupe(laneId, dedupeKey) {
  if (!dedupeKey) return null;
  const list = db.cardsByLane[laneId] || [];
  for (const id of list) {
    const it = db.cards[id];
    if (it && it.dedupeKey === dedupeKey) return it;
  }
  return null;
}

export function addHistory(userId, item) {
  const h = db.history[userId] || (db.history[userId] = []);
  h.unshift({ ...item, seenAt: new Date().toISOString() });
  if (h.length > MAX_HISTORY) h.length = MAX_HISTORY;
  save();
}
