// whileaway — environment config. Loaded in all three contexts (service worker via
// importScripts, popup via <script>, content scripts via the manifest, same isolated world).
//
// Flip ENV to "dev" for localhost, "prod" for your deployed backend. The popup can also
// override the base URL at runtime (stored in chrome.storage as "vf_api_base").
var VF_ENV = "dev"; // "dev" | "prod" — flip to "prod" when packaging for the Web Store
var VF_DEBUG = false; // console logs on the AI page; off by default (silent degradation) — flip on to debug

var VF_ENVS = {
  dev: { api: "http://localhost:4000" },
  prod: { api: "https://whileaway.fly.dev" },
};

var VF_API_BASE = VF_ENVS[VF_ENV].api;

if (typeof globalThis !== "undefined") {
  globalThis.VF_API_BASE = VF_API_BASE;
  globalThis.VF_DEBUG = VF_DEBUG;
}
