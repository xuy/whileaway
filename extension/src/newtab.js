// whileaway new-tab surface (T-71). A second, detection-free surface in the same extension: every
// new tab is a found-moment, broader and more reliable than the AI-spinner overlay. It DELIVERS
// (consumes) the next card via GET /v1/feed/next — a new tab is a real glance — and marks it seen
// after a short on-screen dwell, so the seen-rate reflects genuine attention. Reuses the popup's
// backend/token config (same storage keys); no trigger-site detection at all.
const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;
const DEFAULT_BASE = typeof VF_API_BASE !== "undefined" ? VF_API_BASE : "http://localhost:4000";
const $ = (id) => document.getElementById(id);
const ACCENT = { calendar: "#7c6cff", email: "#7c6cff", note: "#7c6cff", article: "#3a86ff", discussion: "#ff8c42" };

const state = { base: DEFAULT_BASE, token: null, user: null };

async function loadSettings() {
  const s = await api.storage.local.get(["vf_api_base", "vf_token", "vf_user"]);
  state.base = s.vf_api_base || DEFAULT_BASE;
  state.token = s.vf_token || null;
  state.user = s.vf_user || null;
  if (!state.user) {
    state.user = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2);
    await api.storage.local.set({ vf_user: state.user });
  }
}
function url(p) { return state.base.replace(/\/$/, "") + p; }
function headers() {
  const h = { "Content-Type": "application/json" };
  if (state.token) h.Authorization = "Bearer " + state.token;
  if (state.user) h["X-Whileaway-User"] = state.user;
  return h;
}
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }

function renderCard(item) {
  const accent = item.accent || ACCENT[item.kind] || "#3a86ff";
  const img = item.imageUrl ? `<img src="${esc(item.imageUrl)}" referrerpolicy="no-referrer" onerror="this.remove()"/>` : "";
  const link = item.url ? `<a class="plink" href="${esc(item.url)}" target="_blank" rel="noreferrer">Open →</a>` : "";
  $("slot").innerHTML = `
    <div class="pcard" id="pcard">
      <div class="pbar"><span class="pdot" style="background:${accent}"></span>${esc(item.sourceLabel || item.source || "whileaway")}</div>
      ${img}
      <div class="pbody">
        <div class="ptitle">${esc(item.title || "")}</div>
        ${item.body ? `<div class="pdesc">${esc(item.body)}</div>` : ""}
        ${link}
      </div>
    </div>`;
  requestAnimationFrame(() => $("pcard") && $("pcard").classList.add("in"));
}

function renderEmpty(html) { $("slot").innerHTML = `<div class="empty">${html}</div>`; }

async function markSeenSoon(id) {
  // Only counts as seen if the tab stays visible a few seconds — a genuine glance, not a
  // fling-open-and-close. Cancel if the tab is hidden/closed before the dwell elapses.
  if (!id) return;
  let fired = false;
  const fire = () => {
    if (fired || document.hidden) return; fired = true;
    fetch(url("/v1/feed/seen"), { method: "POST", headers: headers(), body: JSON.stringify({ id }) }).catch(() => {});
  };
  setTimeout(fire, 3500);
}

// Deliver only once the tab is actually LOOKED AT. next() consumes a card, so a tab opened in the
// background (middle-click, session restore) must NOT burn one — we wait for it to become visible.
let ran = false;
async function run() {
  if (ran) return; ran = true;
  try {
    const r = await fetch(url("/v1/feed/next"), { headers: headers() });
    if (r.status === 204) {
      renderEmpty(`Your feed is clear.<br/>Tell your agent to push something —<br/><span class="recipe">push me one stoic quote each morning</span>`);
      return;
    }
    if (r.status === 401) {
      renderEmpty(`Connect your feed to see cards here.<br/><a class="plink" href="${esc(url("/"))}" target="_blank" rel="noreferrer">Get your token →</a>`);
      return;
    }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const item = await r.json();
    renderCard(item);
    markSeenSoon(item.id);
  } catch (_) {
    renderEmpty(`Set your backend in the whileaway popup to see cards here.`);
  }
}

(async function init() {
  await loadSettings();
  $("dash").href = url("/");
  if (document.hidden) {
    // opened in the background — defer the (consuming) fetch until the tab is first viewed.
    const onVis = () => { if (!document.hidden) { document.removeEventListener("visibilitychange", onVis); run(); } };
    document.addEventListener("visibilitychange", onVis);
  } else {
    run();
  }
})();
