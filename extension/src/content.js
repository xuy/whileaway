// whileaway content script (MV3, standalone, no imports).
// While the AI generates a reply, surface ONE skimmable item from your feed in a small card.
//
// Privacy stance: this script never reads your prompt, the AI's answer, page links, or any
// page content. It only watches for *that a generation started* (form submit / Enter / send
// click / the AI's own "stop" button appearing) and then asks the backend for a feed item.
(() => {
  "use strict";

  const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;
  const DEFAULT_BASE = typeof VF_API_BASE !== "undefined" ? VF_API_BASE : "http://localhost:4000";
  const DEBUG = typeof VF_DEBUG !== "undefined" && VF_DEBUG;
  const dbg = (...a) => { if (DEBUG) try { console.log("[whileaway]", ...a); } catch (_) {} };

  // Delivery feel — overridable by the backend's /v1/feed/config (cached 1h) and by popup settings.
  const DEFAULT_CFG = { cooldownMs: 20000, minVisibleMs: 1500, displayMs: 11000, maxPerSession: 0 };
  let CFG = { ...DEFAULT_CFG };
  let API_BASE = DEFAULT_BASE;
  let TOKEN = null;
  let USER = null; // stable per-browser id → your own feed/subscriptions on a shared bus

  const STOP_SELECTORS = [
    "[data-testid='stop-button']", "[data-testid*='stop']", "[aria-label*='Stop']",
    "[aria-label*='stop']", "[aria-label*='Arrêt']", "button[title*='Stop']",
  ].join(",");
  const SEND_RE = /send|submit|envoyer|envoi/i;

  function detectSurface() {
    const h = location.host;
    if (/chatgpt\.com|chat\.openai\.com/.test(h)) return "chatgpt";
    if (/claude\.ai/.test(h)) return "claude";
    if (/perplexity\.ai/.test(h)) return "perplexity";
    if (/gemini\.google\.com/.test(h)) return "gemini";
    if (/mistral\.ai/.test(h)) return "mistral";
    if (/copilot\.microsoft\.com/.test(h)) return "copilot";
    if (/deepseek\.com/.test(h)) return "deepseek";
    if (/grok\.com/.test(h)) return "grok";
    return "other";
  }
  const surface = detectSurface();

  let lastShown = 0;
  let showing = false;
  let shownThisSession = 0;

  // ---- settings + runtime config -------------------------------------------
  async function loadSettings() {
    try {
      const s = await api.storage.local.get(["vf_api_base", "vf_token", "vf_cfg", "vf_user"]);
      if (s.vf_api_base) API_BASE = s.vf_api_base;
      if (s.vf_token) TOKEN = s.vf_token;
      USER = s.vf_user || null;
      if (!USER) {
        USER = (self.crypto && crypto.randomUUID) ? crypto.randomUUID() : "u-" + Date.now() + "-" + Math.random().toString(36).slice(2);
        try { await api.storage.local.set({ vf_user: USER }); } catch (_) {}
      }
      if (s.vf_cfg && s.vf_cfg.at && Date.now() - s.vf_cfg.at < 3600_000 && s.vf_cfg.cfg) {
        CFG = { ...DEFAULT_CFG, ...s.vf_cfg.cfg };
        return;
      }
    } catch (_) {}
    try {
      const res = await proxy("/v1/feed/config", { method: "GET" });
      if (res && res.ok && res.body) {
        CFG = { ...DEFAULT_CFG, ...res.body };
        try { await api.storage.local.set({ vf_cfg: { at: Date.now(), cfg: res.body } }); } catch (_) {}
      }
    } catch (_) {}
  }

  // ---- backend access via the service worker (no CORS, token stays out of page) ----
  function proxy(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (TOKEN) headers.Authorization = "Bearer " + TOKEN;
    if (USER) headers["X-Whileaway-User"] = USER;
    return api.runtime.sendMessage({ type: "vf_api", url: API_BASE + path, options: { ...options, headers } });
  }

  // ---- card rendering (closed Shadow DOM, isolated from the page) -----------
  const KIND_ACCENT = {
    calendar: "#7c6cff", email: "#7c6cff", note: "#7c6cff",
    article: "#3a86ff", discussion: "#ff8c42",
  };

  function timeAgo(ts) {
    if (!ts) return "";
    const s = Math.max(0, (Date.now() - new Date(ts).getTime()) / 1000);
    if (s < 90) return "just now";
    const m = s / 60; if (m < 60) return Math.round(m) + "m ago";
    const h = m / 60; if (h < 24) return Math.round(h) + "h ago";
    return Math.round(h / 24) + "d ago";
  }

  function renderCard(item) {
    const accent = item.accent || KIND_ACCENT[item.kind] || "#3a86ff";
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483647;";
    const root = host.attachShadow({ mode: "closed" });

    const wrap = document.createElement("div");
    wrap.style.cssText =
      "width:330px;border-radius:16px;background:rgba(255,255,255,0.96);backdrop-filter:blur(18px) saturate(160%);" +
      "-webkit-backdrop-filter:blur(18px) saturate(160%);border:1px solid rgba(23,22,46,0.10);" +
      "box-shadow:0 18px 48px rgba(40,35,90,0.22);color:#17162e;font-family:'DM Sans',system-ui,-apple-system,sans-serif;overflow:hidden;" +
      "opacity:0;transform:translateY(8px) scale(0.98);transition:opacity .28s ease,transform .28s cubic-bezier(.2,.8,.2,1)";

    const bar = document.createElement("div");
    bar.style.cssText = "display:flex;justify-content:space-between;align-items:center;padding:9px 13px;font-size:11.5px;border-bottom:1px solid rgba(23,22,46,0.07)";
    const tag = document.createElement("span");
    tag.style.cssText = "display:flex;align-items:center;gap:6px;font-weight:600;color:rgba(23,22,46,0.62)";
    const dot = document.createElement("span");
    dot.style.cssText = `width:7px;height:7px;border-radius:50%;background:${accent};display:inline-block`;
    const srcName = document.createElement("span");
    srcName.textContent = item.sourceLabel || item.source || "feed";
    tag.appendChild(dot); tag.appendChild(srcName);
    const close = document.createElement("button");
    close.textContent = "×";
    close.setAttribute("aria-label", "Dismiss");
    close.style.cssText = "background:none;border:none;color:rgba(23,22,46,0.4);font-size:18px;cursor:pointer;line-height:1;padding:0 2px";
    bar.appendChild(tag); bar.appendChild(close);

    if (item.imageUrl) {
      const img = document.createElement("img");
      img.src = item.imageUrl; img.referrerPolicy = "no-referrer"; img.loading = "lazy";
      img.style.cssText = "width:100%;height:128px;object-fit:cover;display:block";
      img.onerror = () => img.remove();
      wrap.appendChild(bar); wrap.appendChild(img);
    } else {
      wrap.appendChild(bar);
    }

    const bodyEl = document.createElement(item.url ? "a" : "div");
    bodyEl.style.cssText = "display:block;padding:13px 14px 11px;text-decoration:none;color:inherit";
    if (item.url) {
      bodyEl.href = /^https?:\/\//i.test(item.url) ? item.url : "#";
      bodyEl.target = "_blank"; bodyEl.rel = "noopener noreferrer";
      bodyEl.style.cursor = "pointer";
    }
    const title = document.createElement("div");
    title.textContent = item.title || "";
    title.style.cssText = "font-weight:600;font-size:15px;line-height:1.32;margin-bottom:5px";
    bodyEl.appendChild(title);
    if (item.body) {
      const desc = document.createElement("div");
      desc.textContent = item.body;
      desc.style.cssText = "font-size:13px;line-height:1.45;color:rgba(23,22,46,0.62)";
      bodyEl.appendChild(desc);
    }
    wrap.appendChild(bodyEl);

    const foot = document.createElement("div");
    foot.style.cssText = "padding:6px 14px 11px;display:flex;justify-content:space-between;align-items:center;font-size:10.5px;color:rgba(23,22,46,0.42)";
    const when = document.createElement("span");
    when.textContent = [item.author, timeAgo(item.ts)].filter(Boolean).join(" · ");
    const brand = document.createElement("span");
    brand.textContent = "whileaway";
    brand.style.cssText = "font-weight:600;letter-spacing:.02em";
    foot.appendChild(when); foot.appendChild(brand);
    wrap.appendChild(foot);

    root.appendChild(wrap);
    document.documentElement.appendChild(host);
    requestAnimationFrame(() => { wrap.style.opacity = "1"; wrap.style.transform = "translateY(0) scale(1)"; });

    let done = false;
    const cleanup = () => {
      if (done) return; done = true;
      wrap.style.opacity = "0"; wrap.style.transform = "translateY(8px) scale(0.98)";
      setTimeout(() => host.remove(), 280);
      showing = false;
    };
    close.addEventListener("click", (e) => { e.preventDefault(); cleanup(); });
    setTimeout(cleanup, CFG.displayMs);
    return cleanup;
  }

  // ---- main: fetch + show one item -----------------------------------------
  async function showItem(force = false) {
    if (showing) { dbg("skip: already showing"); return; }
    if (!force && Date.now() - lastShown < CFG.cooldownMs) { dbg("skip: cooldown"); return; }
    if (!force && CFG.maxPerSession > 0 && shownThisSession >= CFG.maxPerSession) { dbg("skip: session cap"); return; }
    showing = true;
    try {
      const res = await proxy("/v1/feed/next", { method: "GET" });
      if (!res || !res.ok) { dbg("no item", res && res.status); showing = false; return; }
      if (res.status === 204 || !res.body) { dbg("queue empty (204)"); showing = false; return; }
      const item = res.body;
      lastShown = Date.now();
      shownThisSession++;
      const shownAt = Date.now();
      renderCard(item);
      // Mark seen only after it's been visible a beat AND the tab is foreground.
      const reportSeen = () => {
        if (document.hidden) return;
        document.removeEventListener("visibilitychange", onVis);
        proxy("/v1/feed/seen", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: item.id }),
        }).then(() => dbg("seen:", item.title)).catch(() => {});
      };
      const onVis = () => { if (!document.hidden) reportSeen(); };
      document.addEventListener("visibilitychange", onVis);
      setTimeout(reportSeen, CFG.minVisibleMs);
    } catch (e) {
      dbg("error", e && e.message);
      showing = false;
    }
  }

  // ---- triggers: detect that a generation started (no content is read) ------
  document.addEventListener("submit", () => { dbg("trigger: submit"); setTimeout(() => showItem(), 250); }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const t = e.target;
    if (t && t.closest && t.closest('textarea, [contenteditable], [role="textbox"]')) {
      dbg("trigger: Enter"); setTimeout(() => showItem(), 250);
    }
  }, true);

  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest('button, [role="button"]');
    if (!btn) return;
    const label = ((btn.getAttribute("aria-label") || "") + " " + (btn.getAttribute("data-testid") || "") + " " + (btn.getAttribute("title") || "")).toLowerCase();
    if (SEND_RE.test(label)) { dbg("trigger: send click"); setTimeout(() => showItem(), 300); }
  }, true);

  const obs = new MutationObserver(() => {
    let hit = false;
    try { hit = !!document.querySelector(STOP_SELECTORS); } catch (_) {}
    if (hit) { dbg("trigger: stop button"); setTimeout(() => showItem(), 200); }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });

  // Let the popup trigger an immediate card on this tab ("Show a card now").
  api.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "vf_show_now") showItem(true);
  });

  loadSettings().then(() => dbg("active on surface:", surface));
})();
