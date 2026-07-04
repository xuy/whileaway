// Activation & seen-rate metrics (T-63). The launch headline is the SEEN-RATE per delivered card:
// of all cards the bus handed a client, how many did the human actually acknowledge? Everything
// else is the funnel that leads there (signup → token → delivered → seen).
//
// Two kinds of numbers:
//   • Monotonic event counters (this module) for flow events that aren't reconstructable from
//     state — a push, a signup, a token mint, a delivery IMPRESSION. Stored in db.metrics so they
//     survive restarts (JSON driver: free; sqlite: its own table).
//   • Derived gauges, computed from live state at read time — honest by construction, no drift,
//     cheap at v0 scale.
//
// The headline SEEN-RATE is derived from delivery state, NOT from raw counters: db.delivery holds
// exactly one record per (user, item) that has ever been delivered, with a seenAt once the human
// acknowledges it. So "cards delivered" and "cards seen" are counted on the SAME per-card basis —
// a must_see/recurring card re-surfaced N times still counts as one delivered card and (at most)
// one seen card. Counting raw delivery events in the denominator would bias the rate downward.
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

  // Derived from live delivery state, all on the same per-(user,card) basis. delivery keys are
  // `${userId}|${cardId}`; cardIds are `card_<uuid>` (never contain "|"), and lastIndexOf keeps a
  // userId that itself contains "|" (self-host browser ids) intact.
  let deliveredCards = 0, seenCards = 0;
  const activatedUsers = new Set();
  const seenUsers = new Set();
  for (const [key, st] of Object.entries(db.delivery || {})) {
    if (!st || !st.deliveredCount) continue;
    deliveredCards++;
    const uid = key.slice(0, key.lastIndexOf("|"));
    if (uid) activatedUsers.add(uid);
    if (st.seenAt) {
      seenCards++;
      if (uid) seenUsers.add(uid);
    }
  }

  return {
    // headline: of distinct cards delivered to someone, how many did they acknowledge?
    seenRate: deliveredCards ? +(seenCards / deliveredCards).toFixed(4) : null,
    deliveredCards,
    seenCards,
    // funnel counters (cumulative since first boot)
    signups: c.signups || 0,
    tokensMinted: c.tokensMinted || 0,
    pushes: c.pushes || 0,
    deliveries: c.deliveries || 0, // total delivery events/impressions (re-surfaces included)
    // gauges (current state)
    owners: Object.keys(db.owners || {}).length,
    liveTokens: Object.keys(db.keys || {}).length,
    lanes: Object.keys(db.lanes || {}).length,
    cards: Object.keys(db.cards || {}).length,
    activatedUsers: activatedUsers.size,
    seenUsers: seenUsers.size,
  };
}
