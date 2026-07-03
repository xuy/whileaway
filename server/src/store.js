// In-memory data store with JSON persistence. Small and dependency-free on purpose — the
// shape is what matters; swapping in Postgres later is a mechanical change behind these
// accessors. Everything the bus needs lives here: owners, publisher keys (hashed), channels,
// items, per-user subscriptions, per-user delivery state, and per-user history.
import fs from "node:fs";
import path from "node:path";

const STATE_FILE = process.env.VIBEFEED_STATE || path.join(process.cwd(), ".vibefeed-state.json");

export const db = {
  owners: {}, // ownerId -> { id, label }
  keys: {}, // sha256(key) -> { id, ownerId, label, createdAt }
  channels: {}, // channelId(slug) -> { id, title, description, icon, accent, kind, ownerId, visibility, createdAt }
  items: {}, // itemId -> item (see bus.normalizeItem)
  itemsByChannel: {}, // channelId -> [itemId, ...] (newest last)
  subs: {}, // userId -> { channelId -> { muted, createdAt } }
  delivery: {}, // `${userId}|${itemId}` -> { deliveredCount, lastDeliveredAt, seenAt }
  history: {}, // userId -> [ {item snapshot, seenAt}, ... ] newest first
  cursor: {}, // userId -> { lastChannelId }  (for round-robin fairness)
};

const MAX_ITEMS_PER_CHANNEL = 250;
const MAX_HISTORY = 200;

export function load() {
  try {
    const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
    for (const k of Object.keys(db)) if (raw[k]) db[k] = raw[k];
  } catch {
    /* first run */
  }
}

let saveTimer = null;
export function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(db));
    } catch (e) {
      console.warn("[vibefeed] persist failed:", e.message);
    }
  }, 300);
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

export function pushItemRecord(item) {
  db.items[item.id] = item;
  const list = db.itemsByChannel[item.channelId] || (db.itemsByChannel[item.channelId] = []);
  if (!list.includes(item.id)) list.push(item.id);
  // trim oldest, dropping their item records + delivery state would be ideal; keep simple: cap list.
  if (list.length > MAX_ITEMS_PER_CHANNEL) {
    const dropped = list.splice(0, list.length - MAX_ITEMS_PER_CHANNEL);
    for (const id of dropped) delete db.items[id];
  }
  save();
}

export function findByDedupe(channelId, dedupeKey) {
  if (!dedupeKey) return null;
  const list = db.itemsByChannel[channelId] || [];
  for (const id of list) {
    const it = db.items[id];
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
