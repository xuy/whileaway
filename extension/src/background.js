// whileaway background (MV3 service worker).
// Sole job: a network proxy so content scripts on chatgpt/claude/… can reach the backend
// without tripping the page's CORS. The service worker holds the host_permissions, so its
// fetch is not subject to page-origin CORS. It does NOT read or store anything from the page.
if (typeof importScripts === "function") importScripts("config.js");
const api = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;

api.runtime.onInstalled.addListener(() => console.log("[whileaway] installed"));

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "vf_api") return; // ignore everything else (e.g. vf_show_now is for content)
  (async () => {
    const options = msg.options || {};
    try {
      const r = await fetch(msg.url, options);
      let body = null;
      if (r.status !== 204) { try { body = await r.json(); } catch (_) { body = null; } }
      sendResponse({ ok: r.ok, status: r.status, body });
    } catch (e) {
      sendResponse({ ok: false, status: 0, error: String(e && e.message) });
    }
  })();
  return true; // async response
});
