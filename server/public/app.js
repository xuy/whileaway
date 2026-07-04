// whileaway connect page — get your token, connect the extension (one paste) + your agent (MCP),
// and answer "is it working?" with live history. NOT an API console: consumer/self-feed framing.
// Works in both modes: hosted (magic-link session → minted bearer token) and self-host (none:
// header identity + the boot publisher key from /v1/admin/hello).
const $ = (id) => document.getElementById(id);

function makeUser() {
  let u = localStorage.getItem("vf_user");
  if (!u) { u = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2); localStorage.setItem("vf_user", u); }
  return u;
}
const cfg = {
  base: (localStorage.getItem("vf_base") || location.origin || "http://localhost:4000").replace(/\/$/, ""),
  token: localStorage.getItem("vf_token") || "",
  user: makeUser(),
  authMode: "none",
  email: "",
};
const url = (p) => cfg.base + p;

// Identity headers per mode. Hosted: the bearer token names the user. Self-host: the browser id
// header (the boot key is added as bearer too — harmless, it's ignored for identity in none mode).
function h(json) {
  const o = json ? { "Content-Type": "application/json" } : {};
  if (cfg.authMode !== "hosted") o["X-Whileaway-User"] = cfg.user;
  if (cfg.token) o.Authorization = "Bearer " + cfg.token;
  return o;
}
async function apiGet(p) { const r = await fetch(url(p), { headers: h(), credentials: "same-origin" }); return unwrap(r); }
async function apiPost(p, body, cookie) {
  const r = await fetch(url(p), { method: "POST", headers: h(true), credentials: cookie ? "same-origin" : "same-origin", body: body ? JSON.stringify(body) : "{}" });
  return unwrap(r);
}
async function unwrap(r) { let b = null; if (r.status !== 204) { try { b = await r.json(); } catch (_) {} } return { status: r.status, ok: r.ok, body: b }; }

let toastT; function toast(m, bad) { const t = $("toast"); t.textContent = m; t.style.background = bad ? "#ec5b5b" : "#17162e"; t.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove("show"), 2200); }
function esc(s) { const d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
function hl(s) { s = s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); return s.replace(/("(?:[^"\\]|\\.)*")/g, '<span class="s">$1</span>'); }
function timeAgo(ts) { if (!ts) return ""; const s = Math.max(0, (Date.now() - new Date(ts)) / 1000); if (s < 90) return "just now"; const m = s / 60; if (m < 60) return Math.round(m) + "m ago"; const hh = m / 60; if (hh < 24) return Math.round(hh) + "h ago"; return Math.round(hh / 24) + "d ago"; }
function show(id) { for (const s of ["loading", "signin", "connected"]) $(s).classList.toggle("hidden", s !== id); }

// ---------- status ----------
async function refreshStatus() {
  try { const r = await apiGet("/health"); if (!r.ok) throw 0; $("dot").className = "dot ok"; $("statusText").textContent = "bus online"; return true; }
  catch { $("dot").className = "dot bad"; $("statusText").textContent = "offline"; return false; }
}

// ---------- token ----------
function setToken(t, note) {
  cfg.token = t || "";
  if (t) localStorage.setItem("vf_token", t); else localStorage.removeItem("vf_token");
  $("tokenVal").value = t || "";
  $("mintToken").classList.toggle("hidden", !!t);
  if (note) $("tokenHint").textContent = note;
  renderSetup(); renderMcp();
}
async function mintToken() {
  const r = await apiPost("/v1/tokens", { label: "dashboard" }, true); // cookie-auth'd (hosted)
  if (r.ok && r.body && r.body.token) { setToken(r.body.token, "Shown once — saved in this browser. Copy it somewhere safe."); toast("Token generated"); return true; }
  toast(r.body && r.body.error || "could not mint token", true); return false;
}

// ---------- setup code (T-33) ----------
function setupCode() { return "wa1:" + btoa(JSON.stringify({ url: cfg.base, token: cfg.token || "" })); }
function renderSetup() { $("setupCode").value = cfg.token ? setupCode() : "generate a token first ↑"; }

// ---------- mcp snippets ----------
function renderMcp() {
  const t = cfg.token || "<your-token>";
  const cli = `claude mcp add whileaway \\\n  -e WHILEAWAY_URL=${cfg.base} \\\n  -e WHILEAWAY_TOKEN=${t} \\\n  -- npx -y whileaway-mcp`;
  const json = JSON.stringify({ mcpServers: { whileaway: { command: "npx", args: ["-y", "whileaway-mcp"], env: { WHILEAWAY_URL: cfg.base, WHILEAWAY_TOKEN: t } } } }, null, 2);
  $("mcpCli").innerHTML = hl(cli); $("mcpCli")._raw = cli;
  $("mcpJson").innerHTML = hl(json); $("mcpJson")._raw = json;
}

// ---------- history ("is it working?") ----------
async function loadHistory() {
  const box = $("history");
  const r = await apiGet("/v1/feed/history?limit=15");
  if (r.status === 401) { box.innerHTML = '<div class="empty">Token not accepted — generate a fresh one above.</div>'; return; }
  if (!r.ok) { box.innerHTML = '<div class="empty">Bus offline.</div>'; return; }
  const items = (r.body && r.body.items) || [];
  if (!items.length) {
    box.innerHTML = '<div class="empty">No cards seen yet. Tell your agent to push one — e.g. <code>push me one stoic quote each morning</code> — or install the extension and open an AI chat. New cards show here.</div>';
    return;
  }
  box.innerHTML = items.map((it) => `<div class="hitem"><span class="hsrc">${esc(it.sourceLabel || it.source || "")}</span> ${esc(it.title || "")} <span class="hwhen">· ${timeAgo(it.seenAt)}</span></div>`).join("");
}

// ---------- lanes (list + mute only) ----------
async function loadLanes() {
  const box = $("lanes");
  const r = await apiGet("/v1/channels");
  if (!r.ok) { box.innerHTML = '<div class="empty">Bus offline.</div>'; return; }
  const lanes = (r.body && r.body.channels) || [];
  if (!lanes.length) { box.innerHTML = '<div class="empty">No lanes yet.</div>'; return; }
  box.innerHTML = "";
  for (const c of lanes) {
    const row = document.createElement("div");
    row.className = "lane";
    const meta = [c.kind, c.owned ? "yours" : c.visibility].filter(Boolean).join(" · ");
    row.innerHTML = `<div class="grow"><div class="nm">${esc(c.title)}</div><div class="meta">${esc(meta)}</div></div>` +
      (c.subscribed ? `<span class="mutelink ${c.muted ? "muted" : ""}">${c.muted ? "unmute" : "mute"}</span>` : "");
    const sw = document.createElement("label"); sw.className = "switch";
    const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = !!c.subscribed;
    const sl = document.createElement("span"); sl.className = "slider";
    cb.addEventListener("change", async () => {
      const r2 = await apiPost("/v1/subscriptions", { channelId: c.id, action: cb.checked ? "subscribe" : "unsubscribe" });
      if (r2.ok) loadLanes(); else { cb.checked = !cb.checked; toast(r2.body && r2.body.error || "error", true); }
    });
    sw.appendChild(cb); sw.appendChild(sl);
    row.appendChild(sw);
    const ml = row.querySelector(".mutelink");
    if (ml) ml.addEventListener("click", async () => {
      const r2 = await apiPost("/v1/subscriptions", { channelId: c.id, action: c.muted ? "unmute" : "mute" });
      if (r2.ok) loadLanes(); else toast(r2.body && r2.body.error || "error", true);
    });
    box.appendChild(row);
  }
}

// ---------- render connected ----------
async function renderConnected() {
  show("connected");
  // Hosted: ensure we have a bearer token (mint one on first visit so history/lanes work and the
  // user has something to copy). Self-host: token is the boot key (already set).
  if (cfg.authMode === "hosted" && !cfg.token) { await mintToken(); }
  else { setToken(cfg.token, cfg.token ? "" : "No token — paste your WHILEAWAY_KEY, or check the server log."); }
  $("signoutRow").innerHTML = cfg.authMode === "hosted"
    ? `Signed in${cfg.email ? " as " + esc(cfg.email) : ""} · <a href="#" id="signout">sign out</a>` : "Self-hosted — no account needed.";
  const so = $("signout");
  if (so) so.addEventListener("click", async (e) => { e.preventDefault(); try { await fetch(url("/api/auth/sign-out"), { method: "POST", credentials: "same-origin" }); } catch (_) {} localStorage.removeItem("vf_token"); location.reload(); });
  renderSetup(); renderMcp();
  loadHistory(); loadLanes();
}

// ---------- copy wires ----------
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-copy]"); if (!b) return;
  const el = $(b.dataset.copy); navigator.clipboard.writeText((el && el._raw) || "").then(() => toast("Copied"));
});
$("copyToken").addEventListener("click", () => { if (!cfg.token) return toast("no token yet", true); navigator.clipboard.writeText(cfg.token).then(() => toast("Token copied")); });
$("copySetup").addEventListener("click", () => { if (!cfg.token) return toast("generate a token first", true); navigator.clipboard.writeText(setupCode()).then(() => toast("Setup code copied — paste it in the extension")); });
$("mintToken").addEventListener("click", mintToken);

// ---------- sign in ----------
$("sendLink").addEventListener("click", async () => {
  const email = $("email").value.trim();
  if (!email || !/.+@.+\..+/.test(email)) return toast("enter a valid email", true);
  $("sendLink").disabled = true;
  try {
    const r = await fetch(url("/api/auth/sign-in/magic-link"), { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ email, callbackURL: "/" }) });
    if (r.ok) $("signinHint").textContent = "Check your email and click the link to finish. (Running locally? The link is printed in the server log.)";
    else $("signinHint").textContent = "Couldn't send the link — try again.";
  } catch (_) { $("signinHint").textContent = "Network error — is the bus reachable?"; }
  $("sendLink").disabled = false;
});
$("email").addEventListener("keydown", (e) => { if (e.key === "Enter") $("sendLink").click(); });

// ---------- boot ----------
(async function init() {
  await refreshStatus();
  try { const c = await apiGet("/v1/feed/config"); if (c.ok && c.body && c.body.authMode) cfg.authMode = c.body.authMode; } catch (_) {}

  if (cfg.authMode === "hosted") {
    const me = await apiGet("/v1/me"); // cookie session
    if (me.ok && me.body && me.body.user) { cfg.email = me.body.user.email || ""; await renderConnected(); }
    else show("signin");
  } else {
    // self-host: grab the boot publisher key (loopback only) so the token/snippets are prefilled.
    try { const r = await fetch(url("/v1/admin/hello")); if (r.ok) { const d = await r.json(); if (!cfg.token && d.key) cfg.token = d.key; if (d.base) cfg.base = d.base.replace(/\/$/, ""); } } catch (_) {}
    await renderConnected();
  }
})();
