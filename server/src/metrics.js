// Activation & seen-rate metrics (T-63). The launch headline is the SEEN-RATE per delivered card:
// of all cards the bus handed a client, how many did the human actually acknowledge? Everything
// else is the funnel that leads there (signup → token → delivered → seen).
//
// Two kinds of numbers:
//   • Monotonic event counters (this module) for flow events that aren't reconstructable from
//     state — a card delivered, a card seen, a push, a signup, a token mint. Stored in db.metrics
//     so they survive restarts (JSON driver: free; sqlite: its own table).
//   • Derived gauges, computed from live state at read time (distinct activated users, live
//     tokens, lanes) — honest by construction, no drift, cheap at v0 scale.
import { db, save } from "./store.js";

function counters() {
  return db.metrics || (db.metrics = {});
}

// Increment a named counter and schedule a (debounced) persist. Hot-path safe: callers on the
// delivery path already trigger save(); the extra debounced save() here is coalesced.
export function bump(name, n = 1) {
  const c = counters();
  c[name] = (c[name] || 0) + n;
  save();
}

export function counterValue(name) {
  return counters()[name] || 0;
}

// The activation funnel + headline seen-rate. Counters are cumulative-since-first-boot; gauges
// reflect current state. seenRate is the number we actually launch on.
export function snapshot() {
  const c = counters();
  const delivered = c.delivered || 0;
  const seen = c.seen || 0;

  // Derived from live state: distinct users who have ever received a delivery ("activated"), and
  // how many of those have acknowledged at least one card. delivery keys are `${userId}|${itemId}`.
  const activatedUsers = new Set();
  const seenUsers = new Set();
  for (const [key, st] of Object.entries(db.delivery || {})) {
    const uid = key.slice(0, key.lastIndexOf("|"));
    if (!uid) continue;
    activatedUsers.add(uid);
    if (st && st.seenAt) seenUsers.add(uid);
  }

  return {
    // headline
    seenRate: delivered ? +(seen / delivered).toFixed(4) : null,
    // funnel counters (cumulative)
    signups: c.signups || 0,
    tokensMinted: c.tokensMinted || 0,
    pushes: c.pushes || 0,
    delivered,
    seen,
    // gauges (current state)
    owners: Object.keys(db.owners || {}).length,
    liveTokens: Object.keys(db.keys || {}).length,
    lanes: Object.keys(db.channels || {}).length,
    items: Object.keys(db.items || {}).length,
    activatedUsers: activatedUsers.size,
    seenUsers: seenUsers.size,
  };
}
