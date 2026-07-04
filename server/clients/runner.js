// Reference push-clients. These are NOT part of the bus — they're ordinary API clients that
// fetch public content and PUSH it into channels using a publisher key, exactly like any
// third-party integrator would. They can run in-process (convenience for local self-host) or
// standalone via `npm run pushers`. The bus itself never reaches out to the internet.
import * as wikipedia from "./sources/wikipedia.js";
import * as hackernews from "./sources/hackernews.js";
import * as rss from "./sources/rss.js";
import * as mock from "./sources/mock.js";

// Which source feeds which lane. The lane must already exist and be owned by the key.
const PUSHERS = [
  { lane: "wikipedia", run: () => wikipedia.fetch_(4) },
  { lane: "hackernews", run: () => hackernews.fetch_(6) },
  { lane: "rss", run: () => rss.fetch_(6, parseList(process.env.FEED_RSS) || rss.DEFAULT_FEEDS) },
  { lane: "personal", run: () => mock.fetch_(3) },
];

const INTERVAL_MS = Number(process.env.PUSH_INTERVAL_MS) || 10 * 60 * 1000;

function parseList(s) { return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : null; }

// Map a normalized source item → the push payload the bus expects.
function toPayload(it) {
  return {
    title: it.title,
    body: it.body,
    url: it.url,
    image_url: it.imageUrl,
    kind: it.kind,
    dedupe_key: it.id, // stable per source → re-runs upsert instead of duplicating
    delivery: { class: "ambient", priority: 50 },
  };
}

async function pushOne(apiBase, key, lane, payload) {
  const r = await fetch(`${apiBase}/v1/lanes/${lane}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + key },
    body: JSON.stringify(payload),
  });
  if (!r.ok) throw new Error(`push ${lane} -> ${r.status}`);
  return r.json();
}

async function runRound(apiBase, key) {
  for (const p of PUSHERS) {
    try {
      const items = await p.run();
      let n = 0, fresh = 0;
      for (const it of items) {
        try { const res = await pushOne(apiBase, key, p.lane, toPayload(it)); n++; if (!res.deduped) fresh++; }
        catch (_) {}
      }
      console.log(`[pusher] ${p.lane}: pushed ${n} (${fresh} new)`);
    } catch (e) {
      console.warn(`[pusher] ${p.lane} failed:`, e.message);
    }
  }
}

export async function startPushers(apiBase, key) {
  await runRound(apiBase, key); // warm immediately
  const t = setInterval(() => runRound(apiBase, key).catch(() => {}), INTERVAL_MS);
  t.unref?.();
}

// Standalone entry: `node clients/runner.js`  (uses WHILEAWAY_API + WHILEAWAY_KEY)
if (import.meta.url === `file://${process.argv[1]}`) {
  const apiBase = process.env.WHILEAWAY_API || "http://localhost:4000";
  const key = process.env.WHILEAWAY_KEY;
  if (!key) { console.error("set WHILEAWAY_KEY to a publisher key (see the bus startup log)"); process.exit(1); }
  startPushers(apiBase, key);
}
