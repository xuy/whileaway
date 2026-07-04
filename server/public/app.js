// whileaway console — a thin client over the /v1 API, presented as developer docs.
const $ = (id) => document.getElementById(id);
const qs1 = (s, r = document) => r.querySelector(s);

// ---------- config / identity ----------
function makeUser() {
  let u = localStorage.getItem("vf_user");
  if (!u) { u = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2); localStorage.setItem("vf_user", u); }
  return u;
}
const cfg = {
  base: localStorage.getItem("vf_base") || location.origin || "http://localhost:4000",
  key: localStorage.getItem("vf_key") || "",
  user: makeUser(),
};
const keyOrVar = () => cfg.key || "$WHILEAWAY_KEY";
const baseClean = () => cfg.base.replace(/\/$/, "");
function url(p) { return baseClean() + p; }

// ---------- api ----------
// Always carry the browser identity; also attach the bearer token when one is configured so
// consumer reads (feed/channels/history) authenticate in hosted mode. In self-host the token is
// ignored for identity, so this is harmless there.
function uheaders(extra) {
  const h = { "X-Whileaway-User": cfg.user, ...(extra || {}) };
  if (cfg.key && !h.Authorization) h.Authorization = "Bearer " + cfg.key;
  return h;
}
async function apiGet(p) { const r = await fetch(url(p), { headers: uheaders() }); return wrap(r); }
async function apiSend(method, p, body, auth) {
  const headers = uheaders(auth ? { "Content-Type": "application/json", Authorization: "Bearer " + cfg.key } : { "Content-Type": "application/json" });
  const r = await fetch(url(p), { method, headers, body: body ? JSON.stringify(body) : undefined });
  return wrap(r);
}
async function wrap(r) { let b = null; if (r.status !== 204) { try { b = await r.json(); } catch (_) {} } return { status: r.status, ok: r.ok, body: b }; }

// ---------- helpers ----------
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function timeAgo(ts) { if (!ts) return ""; const s = Math.max(0, (Date.now() - new Date(ts)) / 1000); if (s < 90) return "just now"; const m = s / 60; if (m < 60) return Math.round(m) + "m ago"; const h = m / 60; if (h < 24) return Math.round(h) + "h ago"; return Math.round(h / 24) + "d ago"; }
let toastT; function toast(m, bad) { const t = $("toast"); t.textContent = m; t.style.background = bad ? "#d9534f" : "#1a1922"; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2400); }

// ---------- code generation ----------
const LANGS = [["curl", "cURL"], ["node", "Node"], ["python", "Python"]];
const codeLang = {}; // group -> lang

function reindent(s, pad) { const p = " ".repeat(pad); return s.split("\n").map((l, i) => (i ? p + l : l)).join("\n"); }
function q(s) { return JSON.stringify(s); }
function jsonLit(o) { return JSON.stringify(o, null, 2); }
function pyVal(v, ind) {
  if (v === null || v === undefined) return "None";
  if (v === true) return "True"; if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map((x) => pyVal(x, ind)).join(", ") + "]";
  const pad = " ".repeat(ind + 4);
  return "{\n" + Object.entries(v).map(([k, val]) => `${pad}${JSON.stringify(k)}: ${pyVal(val, ind + 4)}`).join(",\n") + "\n" + " ".repeat(ind) + "}";
}

function gen(lang, req) {
  const { method, fullUrl, headers, body } = req;
  if (lang === "curl") {
    const lines = [method === "GET" ? `curl ${fullUrl}` : `curl -X ${method} ${fullUrl}`];
    for (const [k, v] of Object.entries(headers)) lines.push(`  -H "${k}: ${v}"`);
    if (body) lines.push(`  -d '${jsonLit(body)}'`);
    return lines.join(" \\\n");
  }
  if (lang === "node") {
    let s = `const res = await fetch(${q(fullUrl)}, {\n  method: ${q(method)},\n  headers: ${reindent(jsonLit(headers), 2)}`;
    if (body) s += `,\n  body: JSON.stringify(${reindent(jsonLit(body), 2)})`;
    s += `\n});\nconst data = await res.json();`;
    return s;
  }
  // python
  let s = `import requests\n\nres = requests.${method.toLowerCase()}(\n    ${q(fullUrl)},\n    headers=${reindent(pyVal(headers, 0), 4)}`;
  if (body) s += `,\n    json=${reindent(pyVal(body, 0), 4)}`;
  s += `,\n)\nprint(res.json())`;
  return s;
}

function hl(s) {
  s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return s.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="s">$1</span>');
}

// Build the code block (tabs + pre) for a group; `reqFn` returns the request shape.
const groupReq = {};
function renderCode(group) {
  const tabs = qs1(`.codetabs[data-code="${group}"]`);
  if (!tabs) return;
  const pre = qs1("pre.code", tabs.parentElement);
  if (!codeLang[group]) codeLang[group] = "curl";
  if (!tabs.dataset.built) {
    tabs.innerHTML = LANGS.map(([id, label]) => `<button data-lang="${id}"${codeLang[group] === id ? ' class="on"' : ""}>${label}</button>`).join("") +
      `<button class="copy" data-copy>⧉ Copy</button>`;
    tabs.dataset.built = "1";
    tabs.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.copy) { navigator.clipboard.writeText(pre._raw || "").then(() => toast("Copied to clipboard")); return; }
      codeLang[group] = b.dataset.lang;
      tabs.querySelectorAll("[data-lang]").forEach((x) => x.classList.toggle("on", x === b));
      paint();
    });
  }
  function paint() {
    const raw = gen(codeLang[group], groupReq[group]());
    pre._raw = raw;
    pre.innerHTML = hl(raw);
  }
  paint();
}

// ---------- request shapes per group ----------
const PROD_HEADERS = () => ({ Authorization: "Bearer " + keyOrVar(), "Content-Type": "application/json" });

function buildItemBody() {
  const b = { title: $("p_title").value || "Your title" };
  if ($("p_body").value) b.body = $("p_body").value;
  if ($("p_url").value) b.url = $("p_url").value;
  if ($("p_img").value) b.image_url = $("p_img").value;
  b.kind = $("p_kind").value;
  if ($("p_dedupe").value) b.dedupe_key = $("p_dedupe").value;
  const delivery = { class: $("p_class").value, priority: Number($("p_prio").value) };
  if ($("p_expires").value) delivery.expires_at = new Date($("p_expires").value).toISOString();
  if ($("p_repeat").value === "recurring") {
    delivery.repeat = { mode: "recurring", cooldown_s: Number($("p_cooldown").value) || 0 };
    if ($("p_max").value) delivery.repeat.max = Number($("p_max").value);
  }
  b.delivery = delivery;
  return b;
}
function buildChannelBody() {
  const b = { id: $("nc_id").value || "reading-list", title: $("nc_title").value || "Reading List" };
  if ($("nc_desc").value) b.description = $("nc_desc").value;
  b.kind = $("nc_kind").value; b.visibility = $("nc_vis").value; b.accent = $("nc_accent").value;
  return b;
}

groupReq.qs = () => ({ method: "POST", fullUrl: `${baseClean()}/v1/channels/personal/items`, headers: PROD_HEADERS(),
  body: { title: "Standup in 10 minutes", body: "Daily · Google Meet", kind: "calendar", delivery: { class: "must_see", priority: 90 } } });
groupReq.it = () => ({ method: "POST", fullUrl: `${baseClean()}/v1/channels/${$("p_channel").value || "personal"}/items`, headers: PROD_HEADERS(), body: buildItemBody() });
groupReq.ch = () => ({ method: "POST", fullUrl: `${baseClean()}/v1/channels`, headers: PROD_HEADERS(), body: buildChannelBody() });
groupReq.feed = () => ({ method: "GET", fullUrl: `${baseClean()}/v1/feed/next`, headers: { "X-Whileaway-User": cfg.user } });
groupReq.auth = () => ({ method: "POST", fullUrl: `${baseClean()}/v1/channels/personal/items`, headers: PROD_HEADERS(), body: { title: "Authenticated push" } });

// ---------- parameter tables ----------
function renderParams(id, rows) {
  $(id).innerHTML = `<thead><tr><th style="width:200px">Parameter</th><th>Description</th></tr></thead><tbody>` +
    rows.map((r) => `<tr><td><span class="pname">${esc(r.name)}</span>${r.req ? '<span class="req">REQUIRED</span>' : ""}<div class="ptype">${esc(r.type)}</div></td><td class="pdesc">${r.desc}</td></tr>`).join("") + `</tbody>`;
}
const ITEM_PARAMS = [
  { name: "title", type: "string", req: true, desc: "The card headline — the glanceable payload itself." },
  { name: "body", type: "string", desc: "Supporting line shown under the title." },
  { name: "url", type: "string", desc: "Click-through link. <code>http(s)</code> only." },
  { name: "image_url", type: "string", desc: "Optional thumbnail. <code>http(s)</code> only." },
  { name: "kind", type: "enum", desc: "<code>note</code> · <code>article</code> · <code>discussion</code> · <code>calendar</code> · <code>email</code> · <code>event</code>. Drives the accent." },
  { name: "dedupe_key", type: "string", desc: "Re-pushing the same key within a channel <b>upserts</b> instead of duplicating." },
  { name: "delivery.class", type: "enum", desc: "<code>ambient</code> shows once; <code>must_see</code> keeps surfacing until seen (never an interrupting notification)." },
  { name: "delivery.priority", type: "integer 0–100", desc: "Higher ranks earlier in the feed." },
  { name: "delivery.expires_at", type: "ISO 8601", desc: "Dropped if not delivered by this time." },
  { name: "delivery.repeat", type: "object", desc: "<code>{ mode: 'once' | 'recurring', cooldown_s, max }</code>." },
];
const CHANNEL_PARAMS = [
  { name: "id", type: "string", desc: "Slug, unique per owner. Defaults from <code>title</code>." },
  { name: "title", type: "string", desc: "Display name." },
  { name: "description", type: "string", desc: "Shown in the directory." },
  { name: "kind", type: "enum", desc: "Default kind for items pushed here." },
  { name: "visibility", type: "enum", desc: "<code>private</code> (only you) · <code>unlisted</code> · <code>public</code> (in the directory)." },
  { name: "accent", type: "hex color", desc: "Card accent for this channel." },
];
const FEED_PARAMS = [
  { name: "X-Whileaway-User", type: "header · string", desc: "Consumer identity. Each value gets its own subscriptions, feed and history on the shared bus." },
];

// ---------- nav ----------
function activateTab(tab) {
  document.querySelectorAll("#nav button").forEach((x) => x.classList.toggle("on", x.dataset.tab === tab));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("on", p.dataset.panel === tab));
  if (location.hash !== "#" + tab) history.replaceState(null, "", "#" + tab);
  if (tab === "overview") loadOverview();
  if (tab === "channels") { loadChannels(); renderParams("chParams", CHANNEL_PARAMS); renderCode("ch"); }
  if (tab === "items") { loadChannelOptions(); renderParams("itParams", ITEM_PARAMS); renderCode("it"); }
  if (tab === "feed") { renderParams("feedParams", FEED_PARAMS); renderCode("feed"); }
  if (tab === "keys") { $("keyVal").value = cfg.key || "(none set — add it in Settings)"; $("keyNote").textContent = cfg.key ? "Used for write requests from this console." : "On a deployed bus, paste your key in Settings; locally it auto-fills."; renderCode("auth"); }
  if (tab === "settings") { $("set_base").value = cfg.base; $("set_key").value = cfg.key; $("set_user").value = cfg.user; }
}
$("nav").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) activateTab(b.dataset.tab); });

// ---------- status / overview ----------
async function refreshStatus() {
  try { const r = await apiGet("/health"); if (!r.ok) throw 0; $("dot").className = "dot ok"; return r.body; }
  catch { $("dot").className = "dot bad"; return null; }
}
async function loadOverview() {
  renderCode("qs");
  const h = await refreshStatus();
  if (h) { $("s_channels").textContent = h.channels; $("s_items").textContent = h.items; $("s_subs").textContent = h.subscriptions; $("s_hist").textContent = h.history; }
}

// ---------- channels ----------
async function loadChannels() {
  try {
    const r = await apiGet("/v1/channels"); const channels = r.body.channels;
    const vc = { public: "pub", private: "priv", unlisted: "unl" };
    $("chRows").innerHTML = channels.map((c) => `<tr>
      <td><span class="mono" style="color:var(--ink);font-size:13px">${esc(c.id)}</span><div class="muted" style="font-size:12px">${esc(c.title)}${c.owned ? " · owned" : ""}</div></td>
      <td><span class="tag">${esc(c.kind)}</span></td>
      <td><span class="tag ${vc[c.visibility] || ""}">${esc(c.visibility)}</span></td>
      <td>${c.subscribed ? (c.muted ? '<span class="muted">muted</span>' : '<span style="color:var(--get)">subscribed</span>') : '<span class="muted">—</span>'}</td>
      <td class="right" style="text-align:right">
        <button class="btn link" data-act="${c.subscribed ? "unsubscribe" : "subscribe"}" data-ch="${esc(c.id)}">${c.subscribed ? "Unsubscribe" : "Subscribe"}</button>
        ${c.subscribed ? `<button class="btn link" data-act="${c.muted ? "unmute" : "mute"}" data-ch="${esc(c.id)}">${c.muted ? "Unmute" : "Mute"}</button>` : ""}
      </td></tr>`).join("");
  } catch { $("chRows").innerHTML = '<tr><td colspan="5" class="muted" style="padding:16px">bus offline</td></tr>'; }
}
$("chRows").addEventListener("click", async (e) => {
  const b = e.target.closest("button[data-act]"); if (!b) return;
  const r = await apiSend("POST", "/v1/subscriptions", { channelId: b.dataset.ch, action: b.dataset.act });
  if (r.ok) loadChannels(); else toast(r.body && r.body.error || "error", true);
});
["nc_id", "nc_title", "nc_desc", "nc_kind", "nc_vis", "nc_accent"].forEach((id) => $(id).addEventListener("input", () => renderCode("ch")));
$("ch_send").addEventListener("click", async () => {
  if (!cfg.key) return toast("set a publisher key in Settings", true);
  const r = await apiSend("POST", "/v1/channels", buildChannelBody(), true);
  showResp("ch", r); if (r.ok) { toast("channel created"); loadChannels(); }
});

// ---------- items ----------
async function loadChannelOptions() {
  try {
    const r = await apiGet("/v1/channels"); const owned = r.body.channels.filter((c) => c.owned);
    const list = owned.length ? owned : r.body.channels;
    const cur = $("p_channel").value;
    // Push targets use the owner-scoped SLUG (the push route resolves it within your namespace);
    // the global id is only for consumer ops like subscribe.
    $("p_channel").innerHTML = list.map((c) => `<option value="${esc(c.slug)}">${esc(c.slug)}</option>`).join("");
    if (cur && list.some((c) => c.slug === cur)) $("p_channel").value = cur;
    else if (list.some((c) => c.slug === "personal")) $("p_channel").value = "personal";
    renderCode("it");
  } catch {}
}
["p_channel", "p_title", "p_body", "p_url", "p_img", "p_kind", "p_dedupe", "p_class", "p_expires", "p_repeat", "p_cooldown", "p_max"].forEach((id) => $(id).addEventListener("input", () => renderCode("it")));
$("p_prio").addEventListener("input", () => { $("p_prioVal").textContent = $("p_prio").value; renderCode("it"); });
$("it_send").addEventListener("click", async () => {
  if (!$("p_title").value.trim()) return toast("title is required", true);
  if (!cfg.key) return toast("set a publisher key in Settings", true);
  const r = await apiSend("POST", `/v1/channels/${$("p_channel").value}/items`, buildItemBody(), true);
  showResp("it", r); if (r.ok) toast("item pushed");
});

// ---------- feed ----------
let lastItem = null;
$("f_next").addEventListener("click", async () => {
  const r = await apiGet("/v1/feed/next");
  lastItem = r.body && r.body.id ? r.body : null;
  showResp("f", r, r.status === 204 ? "// 204 No Content — nothing eligible right now" : undefined);
});
$("f_seen").addEventListener("click", async () => {
  if (!lastItem) return toast("pull an item first", true);
  const r = await apiSend("POST", "/v1/feed/seen", { id: lastItem.id });
  showResp("f", r); if (r.ok) toast("marked seen");
});

// ---------- response rendering ----------
function showResp(prefix, r, override) {
  $(prefix + "_status").textContent = r.status;
  $(prefix + "_status").className = "pill " + (r.ok ? "ok" : "bad");
  $(prefix + "_resp").textContent = override != null ? override : JSON.stringify(r.body, null, 2);
}

// ---------- keys / settings ----------
$("copyKey").addEventListener("click", () => navigator.clipboard.writeText(cfg.key || "").then(() => toast("Copied")));
$("set_save").addEventListener("click", () => {
  cfg.base = $("set_base").value.trim() || cfg.base;
  cfg.key = $("set_key").value.trim();
  localStorage.setItem("vf_base", cfg.base); localStorage.setItem("vf_key", cfg.key);
  $("envBase").textContent = cfg.base.replace(/^https?:\/\//, "");
  toast("Saved"); activateTab(qs1("#nav button.on").dataset.tab);
});

// ---------- seed example values + boot ----------
function seedExamples() {
  $("p_title").value = "Standup in 10 minutes"; $("p_body").value = "Daily · Google Meet";
  $("p_kind").value = "calendar"; $("p_class").value = "must_see"; $("p_prio").value = 90; $("p_prioVal").textContent = "90";
  $("nc_id").value = "reading-list"; $("nc_title").value = "Reading List"; $("nc_desc").value = "Saved articles to skim"; $("nc_kind").value = "article"; $("nc_vis").value = "unlisted";
}
(async function init() {
  try { const r = await fetch(url("/v1/admin/hello")); if (r.ok) { const d = await r.json(); if (!cfg.key && d.key) cfg.key = d.key; if (d.base && !localStorage.getItem("vf_base")) cfg.base = d.base; } } catch {}
  $("envBase").textContent = cfg.base.replace(/^https?:\/\//, "");
  seedExamples();
  const start = (location.hash || "#overview").slice(1);
  activateTab(qs1(`#nav button[data-tab="${start}"]`) ? start : "overview");
})();
