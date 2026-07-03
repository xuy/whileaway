// Tiny in-memory fixed-window rate limiter + hard-cap config. Single-process is fine for v0
// (one bus instance); a distributed deploy would swap this for a shared store behind the same
// call. Defaults are generous enough that normal single-user usage never trips them.
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };

export const LIMITS = {
  pushPerMin: num(process.env.WHILEAWAY_PUSH_PER_MIN, 60), // per token
  pullPerMin: num(process.env.WHILEAWAY_PULL_PER_MIN, 120), // per user
  maxLanesPerOwner: num(process.env.WHILEAWAY_MAX_LANES, 50),
  maxItemsPerOwner: num(process.env.WHILEAWAY_MAX_ITEMS, 10000),
};

const windows = new Map(); // key -> { count, resetAt }

// Consume one unit against `key`. Returns { allowed, retryAfterS }. `now` is injectable for tests.
export function hit(key, max, windowMs, now = Date.now()) {
  let w = windows.get(key);
  if (!w || now >= w.resetAt) { w = { count: 0, resetAt: now + windowMs }; windows.set(key, w); }
  w.count++;
  if (w.count > max) return { allowed: false, retryAfterS: Math.max(1, Math.ceil((w.resetAt - now) / 1000)) };
  return { allowed: true };
}

export function resetLimiter() { windows.clear(); } // test helper
