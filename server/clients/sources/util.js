// Shared helpers for content sources.
// Every source returns an array of *normalized* feed items with this shape:
//   { id, source, sourceLabel, kind, title, body, imageUrl, url, author, ts }
// kind ∈ 'article' | 'discussion' | 'calendar' | 'email' | 'note'

import crypto from "node:crypto";

// fetch with a timeout so one slow/hanging source can't stall a refill.
export async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      ...opts,
      signal: ctrl.signal,
      headers: {
        // A descriptive UA keeps us polite and avoids Reddit/Wikipedia 429s.
        "User-Agent": "whileaway/0.1 (+https://github.com/local/whileaway)",
        Accept: "application/json, text/xml, */*",
        ...(opts.headers || {}),
      },
    });
  } finally {
    clearTimeout(t);
  }
}

export async function fetchJson(url, opts, ms) {
  const r = await fetchWithTimeout(url, opts, ms);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
}

export async function fetchText(url, opts, ms) {
  const r = await fetchWithTimeout(url, opts, ms);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.text();
}

// Stable id from a source key so the same article doesn't re-enter the queue.
export function makeId(source, key) {
  return source + "_" + crypto.createHash("sha1").update(String(key)).digest("hex").slice(0, 16);
}

// Strip tags / collapse whitespace / decode the few entities feeds actually use.
export function stripHtml(s = "") {
  return String(s)
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/\s+/g, " ")
    .trim();
}

export function truncate(s = "", n = 240) {
  s = String(s).trim();
  return s.length > n ? s.slice(0, n - 1).trimEnd() + "…" : s;
}
