// Better Auth integration (T-12) — hosted-mode dashboard login only. Sessions here authenticate
// the web dashboard; the extension and MCP never touch this — they use bearer tokens minted from
// the dashboard (see POST /v1/tokens). Better Auth keeps its OWN tables in a SQLite file; the
// databaseHooks bridge a new signup into our bus store (owner + Personal lane + starter subs).
//
// Migration: Better Auth's schema is created by its CLI — run `npm run auth:migrate` before
// starting in hosted mode (the test harness and deploy do this).
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import * as bus from "./bus.js";
import { bump } from "./metrics.js";

const AUTH_DB = process.env.WHILEAWAY_AUTH_DB || path.join(process.cwd(), ".whileaway-auth.db");
// Required in hosted mode (this module only loads when AUTH_MODE=hosted). Fail closed rather than
// fall back to a shared, guessable default that would sign every deployment's sessions the same.
const SECRET = process.env.WHILEAWAY_AUTH_SECRET;
if (!SECRET) throw new Error("WHILEAWAY_AUTH_SECRET is required in hosted mode (generate one: openssl rand -hex 32)");
const BASE_URL = process.env.WHILEAWAY_URL || `http://localhost:${process.env.PORT || 4000}`;

// Magic-link delivery. Dev/default: log the link (and, if WHILEAWAY_MAGIC_SINK is set, append it
// to that file so tests can read it). A real email provider is wired here when configured — until
// then the console transport is enough for our own testing (per the T-12 decision).
async function sendMagicLink({ email, url }) {
  // Always record the link locally first — the console/sink path is the fail-safe, so a flaky or
  // unconfigured email provider can never block sign-in (dev reads it from the log; tests from the sink).
  const sink = process.env.WHILEAWAY_MAGIC_SINK;
  if (sink) { try { fs.appendFileSync(sink, JSON.stringify({ email, url }) + "\n"); } catch { /* ignore */ } }
  console.log(`[whileaway] magic link for ${email}: ${url}`);

  // Real delivery (best-effort): if a Resend key is configured, email the link. Set
  // WHILEAWAY_RESEND_KEY (+ WHILEAWAY_EMAIL_FROM once you've verified a domain in Resend; the
  // default onboarding@resend.dev only delivers to your own account address). No key → console-only.
  const key = process.env.WHILEAWAY_RESEND_KEY;
  if (!key) return;
  const from = process.env.WHILEAWAY_EMAIL_FROM || "whileaway <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + key, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: email,
        subject: "Your whileaway sign-in link",
        text: `Sign in to whileaway:\n\n${url}\n\nThis link is single-use and expires shortly. If you didn't request it, ignore this email.`,
        html: `<p>Sign in to whileaway:</p><p><a href="${url}">Open your feed →</a></p><p style="color:#6b6a82;font-size:13px">This link is single-use and expires shortly. If you didn't request it, you can ignore this email.</p>`,
      }),
    });
    if (!res.ok) console.warn(`[whileaway] Resend send failed (${res.status}) for ${email} — link still in the log above`);
  } catch (e) {
    console.warn(`[whileaway] Resend send error for ${email}:`, e.message, "— link still in the log above");
  }
}

// Google sign-in is enabled only when its credentials are present (you'll add these pre-launch).
const socialProviders = (process.env.WHILEAWAY_GOOGLE_CLIENT_ID && process.env.WHILEAWAY_GOOGLE_CLIENT_SECRET)
  ? { google: { clientId: process.env.WHILEAWAY_GOOGLE_CLIENT_ID, clientSecret: process.env.WHILEAWAY_GOOGLE_CLIENT_SECRET } }
  : undefined;

// Bridge a brand-new Better Auth user into the bus: create their owner, a private "Personal"
// lane, and seed public starter-channel subscriptions. In v0 the userId and ownerId coincide
// (spec §3 rule 1 — kept as distinct fields regardless). Token minting is on-demand via
// POST /v1/tokens so the plaintext is shown exactly once.
export function provisionUser(userId, label) {
  bus.ensureOwner(userId, label || userId);
  bus.ensureUser(userId); // seed public starter channels
  bus.createLane({ id: "personal", title: "Personal", visibility: "private", kind: "note" }, userId);
  bump("signups"); // top of the activation funnel (T-63)
}

export const auth = betterAuth({
  database: new Database(AUTH_DB),
  secret: SECRET,
  baseURL: BASE_URL,
  telemetry: { enabled: false }, // no phone-home (keeps CI/offline deterministic)
  plugins: [magicLink({ sendMagicLink })],
  ...(socialProviders ? { socialProviders } : {}),
  databaseHooks: {
    user: {
      create: {
        after: async (user) => { try { provisionUser(user.id, user.email || user.name); } catch (e) { console.warn("[whileaway] provisionUser failed:", e.message); } },
      },
    },
  },
});
