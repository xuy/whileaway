// vibefeed — environment config. Loaded in all three contexts (service worker via
// importScripts, popup via <script>, content scripts via the manifest, same isolated world).
//
// Flip ENV to "dev" for localhost, "prod" for your deployed backend. The popup can also
// override the base URL at runtime (stored in chrome.storage as "vf_api_base").
var VF_ENV = "dev"; // "dev" | "prod"
var VF_DEBUG = true; // console logs on the AI page; set false to silence

var VF_ENVS = {
  dev: { api: "http://localhost:4000" },
  // Replace with your Fly app once deployed, e.g. https://vibefeed-bus.fly.dev
  prod: { api: "https://vibefeed-bus.fly.dev" },
};

var VF_API_BASE = VF_ENVS[VF_ENV].api;

if (typeof globalThis !== "undefined") {
  globalThis.VF_API_BASE = VF_API_BASE;
  globalThis.VF_DEBUG = VF_DEBUG;
}
