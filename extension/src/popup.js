// whileaway popup — status, live preview, source toggles, settings, history.
const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;
const DEFAULT_BASE = typeof VF_API_BASE !== "undefined" ? VF_API_BASE : "http://localhost:4000";
const $ = (id) => document.getElementById(id);

const ACCENT = { calendar: "#7c6cff", email: "#7c6cff", note: "#7c6cff", article: "#3a86ff", discussion: "#ff8c42" };

let state = { base: DEFAULT_BASE, token: null, user: null };

async function loadSettings() {
  const s = await api.storage.local.get(["vf_api_base", "vf_token", "vf_user"]);
  state.base = s.vf_api_base || DEFAULT_BASE;
  state.token = s.vf_token || null;
  state.user = s.vf_user || null;
  if (!state.user) {
    state.user = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    await api.storage.local.set({ vf_user: state.user });
  }
  $("apiBase").value = state.base;
  $("token").value = state.token || "";
}

function url(path) { return state.base.replace(/\/$/, "") + path; }
function headers() {
  const h = { "Content-Type": "application/json" };
  if (state.token) h.Authorization = "Bearer " + state.token;
  if (state.user) h["X-Whileaway-User"] = state.user;
  return h;
}
async function get(path) {
  const r = await fetch(url(path), { headers: headers() });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}
async function post(path, body) {
  const r = await fetch(url(path), { method: "POST", headers: headers(), body: JSON.stringify(body || {}) });
  if (!r.ok) throw new Error("HTTP " + r.status);
  return r.json();
}

function timeAgo(ts) {
  if (!ts) return "";
  const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
  if (s < 90) return "just now";
  const m = s / 60; if (m < 60) return Math.round(m) + "m ago";
  const h = m / 60; if (h < 24) return Math.round(h) + "h ago";
  return Math.round(h / 24) + "d ago";
}

let connected = false;
async function refreshStatus() {
  try {
    const h = await get("/health");
    $("pill").className = "pill ok";
    $("statusText").textContent = `connected · ${h.cards} cards · ${h.subscriptions} subs`;
    connected = true;
  } catch (_) {
    $("pill").className = "pill bad";
    $("statusText").textContent = "offline";
    connected = false;
  }
  return connected;
}

// First-run onboarding: shown until a real card previews. Points to the dashboard's connect page
// where a hosted user copies their token + MCP snippet (self-host works with no token at all).
function setOnboarding(show) {
  const box = $("onboard");
  if (!box) return;
  const link = $("connectLink");
  if (link) link.href = url("/"); // site root serves the console/dashboard (T-40 fills it out)
  box.style.display = show ? "block" : "none";
}

// Pull the next card and render it; drives onboarding visibility. Returns true if a card showed.
async function doPreview() {
  try {
    const item = await get("/v1/feed/peek"); // non-mutating — never consumes the card the AI tab will show
    renderPreview(item);
    setOnboarding(!item); // connected but empty → still guide the user
    loadHistory();
    return !!item;
  } catch (_) {
    renderPreview(null);
    setOnboarding(true); // offline or unauthorized (hosted needs a token) → show the connect prompt
    return false;
  }
}

async function loadChannels() {
  const box = $("channels");
  try {
    const d = await get("/v1/lanes");
    box.textContent = "";
    if (!d.lanes.length) { box.innerHTML = '<div class="muted">no lanes yet</div>'; return; }
    for (const c of d.lanes) {
      const row = document.createElement("div");
      row.className = "src";
      const lbl = document.createElement("div");
      lbl.className = "lbl";
      const meta = [c.kind, c.visibility, c.owned ? "owned" : ""].filter(Boolean).join(" · ");
      lbl.innerHTML = `${escape_(c.title)} <span class="kind">${escape_(meta)}</span>` +
        (c.subscribed ? ` <a href="#" class="mutelink" style="font-size:10.5px;color:${c.muted ? "#ec5b5b" : "var(--accent)"}">${c.muted ? "muted" : "mute"}</a>` : "");
      const sw = document.createElement("label");
      sw.className = "switch";
      const cb = document.createElement("input");
      cb.type = "checkbox"; cb.checked = c.subscribed;
      const sl = document.createElement("span");
      sl.className = "slider";
      cb.addEventListener("change", async () => {
        try { await post("/v1/subscriptions", { laneId: c.id, action: cb.checked ? "subscribe" : "unsubscribe" }); loadChannels(); refreshStatus(); }
        catch (_) { cb.checked = !cb.checked; }
      });
      sw.appendChild(cb); sw.appendChild(sl);
      row.appendChild(lbl); row.appendChild(sw);
      const mlink = lbl.querySelector(".mutelink");
      if (mlink) mlink.addEventListener("click", async (e) => {
        e.preventDefault();
        try { await post("/v1/subscriptions", { laneId: c.id, action: c.muted ? "unmute" : "mute" }); loadChannels(); }
        catch (_) {}
      });
      box.appendChild(row);
    }
  } catch (_) {
    box.innerHTML = '<div class="muted">feed disconnected</div>';
  }
}

function renderPreview(item) {
  const box = $("preview");
  box.style.display = "block";
  if (!item) { box.innerHTML = '<div class="muted">nothing right now — subscribe to a lane</div>'; return; }
  const accent = item.accent || ACCENT[item.kind] || "#3a86ff";
  const img = item.imageUrl ? `<img src="${item.imageUrl}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : "";
  box.innerHTML = `
    <div class="pcard">
      <div class="pbar"><span class="pdot" style="background:${accent}"></span>${escape_(item.sourceLabel || item.source)}</div>
      ${img}
      <div class="pbody">
        <div class="ptitle">${escape_(item.title || "")}</div>
        ${item.body ? `<div class="pdesc">${escape_(item.body)}</div>` : ""}
      </div>
    </div>`;
}
function escape_(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

async function loadHistory() {
  const box = $("history");
  try {
    const d = await get("/v1/feed/history?limit=20");
    if (!d.cards.length) { box.innerHTML = '<div class="muted">nothing yet</div>'; return; }
    box.textContent = "";
    for (const it of d.cards) {
      const row = document.createElement("div");
      row.className = "hitem";
      row.innerHTML = `<span class="hsrc">${escape_(it.sourceLabel || it.source)}</span> ${escape_(it.title || "")} <span class="hwhen">· ${timeAgo(it.seenAt)}</span>`;
      box.appendChild(row);
    }
  } catch (_) {
    box.innerHTML = '<div class="muted">feed disconnected</div>';
  }
}

// --- wires ---
$("saveBase").addEventListener("click", async () => {
  state.base = $("apiBase").value.trim() || DEFAULT_BASE;
  await api.storage.local.set({ vf_api_base: state.base });
  await api.storage.local.remove("vf_cfg"); // drop cached config so the new backend's config is fetched
  await refreshStatus(); loadChannels(); doPreview(); // auto-preview so a valid config shows a card immediately
});
$("saveToken").addEventListener("click", async () => {
  state.token = $("token").value.trim() || null;
  if (state.token) await api.storage.local.set({ vf_token: state.token });
  else await api.storage.local.remove("vf_token");
  await refreshStatus(); loadChannels(); doPreview(); // renders a preview within seconds of a valid token
});

// One-paste connect (T-33): decode a `wa1:<base64 {url,token}>` setup code from the dashboard and
// apply both the backend URL and token in a single action — the flabbiest onboarding step, halved.
function parseSetupCode(raw) {
  const s = (raw || "").trim();
  if (!s.startsWith("wa1:")) return null;
  try { const o = JSON.parse(atob(s.slice(4))); if (o && typeof o.url === "string") return { url: o.url, token: o.token || "" }; } catch (_) {}
  return null;
}
$("applySetup").addEventListener("click", async () => {
  const parsed = parseSetupCode($("setupCode").value);
  if (!parsed) return; // silently ignore junk; the field placeholder shows the expected shape
  state.base = parsed.url.replace(/\/$/, "");
  state.token = parsed.token || null;
  await api.storage.local.set({ vf_api_base: state.base });
  if (state.token) await api.storage.local.set({ vf_token: state.token }); else await api.storage.local.remove("vf_token");
  await api.storage.local.remove("vf_cfg"); // refetch the new backend's display config
  $("apiBase").value = state.base; $("token").value = state.token || ""; $("setupCode").value = "";
  await refreshStatus(); loadChannels(); doPreview();
});

$("previewBtn").addEventListener("click", doPreview);

$("showBtn").addEventListener("click", async () => {
  const hint = $("showHint");
  hint.style.display = "block";
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    if (!tab) { hint.textContent = "no active tab"; return; }
    const supported = /chatgpt\.com|chat\.openai\.com|claude\.ai|perplexity\.ai|gemini\.google\.com|mistral\.ai|copilot\.microsoft\.com|deepseek\.com|grok\.com/.test(tab.url || "");
    if (!supported) { hint.textContent = "Open a supported AI tab (ChatGPT, Claude, …) to see it in context."; return; }
    await api.tabs.sendMessage(tab.id, { type: "vf_show_now" });
    hint.textContent = "Card sent to the page ↘";
  } catch (_) {
    hint.textContent = "Couldn't reach the page — reload the AI tab after installing.";
  }
});

(async function init() {
  await loadSettings();
  await refreshStatus();
  loadChannels();
  if (connected) doPreview(); // auto-preview on open
  else setOnboarding(true);
})();
