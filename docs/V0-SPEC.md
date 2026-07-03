# vibefeed v0 — Product & Technical Spec

Status: draft for build · Owner: Eric · Last updated: 2026-07-03

## 1. One-liner

**Your agents push to your idle moments.** While an AI is thinking, vibefeed shows one card you
(or your agents) chose — not an ad. v0 is a single-user product: a hosted service + self-hostable
bus, a Chrome extension that renders cards during AI generations, and an MCP server so any agent
can become a producer in one sentence.

Positioning for launch: *"They're putting ads in your AI wait time. Put your own feed there instead."*

## 2. What v0 is (and is not)

In scope:

- **Hosted instance** at the production domain (signup → working feed in <5 minutes), plus
  **self-host mode** that works exactly like today's repo (no auth, local key).
- **MCP server** (`vibefeed-mcp`, npm, stdio) exposing push + read tools.
- **Chrome extension** published on the Chrome Web Store, authenticated by token.
- **Accounts (hosted only):** email magic link + Google sign-in via Better Auth. Dashboard mints
  bearer tokens. Self-host runs `AUTH_MODE=none`.
- **Lanes:** private channels owned by the user. Agents can create them. Mute/round-robin
  fairness comes free from the existing bus.
- **Default starter channels** (Wikipedia, HN, RSS) as optional subscriptions so the feed is
  alive before any agent pushes.

Out of scope (deliberately deferred, not deleted): teams/join links, public channel directory,
broadcast, remote/OAuth MCP, mobile, Firefox/Safari, payments.

## 3. The team-readiness rules (cost: zero code, all discipline)

v0 is the team architecture instantiated at n=1. Four rules keep the migration additive:

1. **Collapse identities in the auth layer, never the data layer.** A token resolves to a
   `(userId, ownerId)` pair that happens to coincide in v0. `store.js` keeps them distinct.
2. **MCP verbs are group-neutral.** `push_card(lane, …)` — never "my feed". When a lane later
   has 8 subscribers, no agent, prompt, or skill changes.
3. **Token = scoped grant, not account.** v0 mints one god-token per user, but the model is
   `{ principal, scopes: [push:lane/*, read:feed] }`. Teams are new grant combinations, not a
   new auth system.
4. **"Team" is defined as a lane's second subscriber.** The future v0.5 feature is exactly one
   thing: lane → shareable join link. (Do not build it in v0.)

## 4. Architecture

```
                       hosted: vibefeed.<domain>          self-host: localhost:4000
┌─────────────┐  MCP (stdio)  ┌──────────────────────────────────────────┐
│ Claude/agent│──────────────▶│  vibefeed-mcp  ──HTTP──▶  bus (Express)  │
└─────────────┘   push_card   └──────────────────────────────────────────┘
                                     ▲                        │
┌─────────────┐  GET /v1/feed/next   │        SQLite (hosted) │ JSON file (self-host)
│ Chrome ext  │──────────────────────┘
└─────────────┘  trigger: AI generation starts on chatgpt/claude/gemini/perplexity…
```

Components: `server/` (existing bus, modified), `mcp/` (new package in this repo),
`extension/` (existing MV3, modified), `web/` (new: landing + dashboard, served by the bus —
extends the existing `server/public` console rather than a separate app).

## 5. Server changes

### 5.1 Identity & auth

- **`AUTH_MODE=none` (self-host default):** current behavior, unchanged. `X-Vibefeed-User`
  header / `LOCAL_USER`, boot publisher key printed to console.
- **`AUTH_MODE=hosted`:** Better Auth (email magic link + Google), sessions for the web
  dashboard only. Extension and MCP never do OAuth — they use **bearer tokens** minted from the
  dashboard.
- **Unified token resolution:** one middleware resolves `Authorization: Bearer <token>` →
  `{ userId, ownerId, scopes }`. Consumer routes read `userId`; producer routes read `ownerId`
  and check scope. Existing publisher-key hashing in `store.db.keys` is reused; add `userId` and
  `scopes` fields to the key record.
- On signup: create owner + user, mint one god-token, create the private "Personal" lane,
  auto-subscribe to it and to starter channels.

### 5.2 Storage

- Move `store.js` behind the same accessors to **SQLite** (`better-sqlite3`) for hosted; keep the
  JSON file driver for self-host (env-selected). The store was written for this swap ("mechanical
  change behind these accessors" — hold it to that).

### 5.3 Hardening (hosted minimum)

- Rate limits: per-token push (e.g. 60/min), per-user feed pulls (e.g. 120/min).
- Payload caps already exist (256kb); add per-user item cap and lane cap (e.g. 50 lanes).
- CORS: keep `*` for GET feed routes; token is the credential.
- Deploy: Fly.io or Railway, single region, HTTPS, `VIBEFEED_STATE` on a volume until SQLite
  lands. Health check exists (`/health`).

### 5.4 API deltas (existing `/v1` is otherwise unchanged)

| method | path | change |
|--------|------|--------|
| POST | `/v1/tokens` | new (session-auth'd): mint/revoke bearer tokens |
| GET | `/v1/me` | new: identity, lanes, token labels |
| * | all existing | accept unified bearer token; `AUTH_MODE=none` keeps today's behavior |

## 6. MCP server (`vibefeed-mcp`)

npm package, stdio transport, config via `VIBEFEED_URL` + `VIBEFEED_TOKEN`. Thin wrapper over
`/v1` — no state, no intelligence. Tools:

| tool | maps to | notes |
|------|---------|-------|
| `push_card` | POST `/v1/channels/:lane/items` | title, body, url?, image_url?, lane?, priority?, class (`ambient`\|`must_see`), expires_at?, repeat? (`once`\|`recurring`+cooldown_s+max), dedupe_key?. Creates the lane if missing. |
| `push_deck` | loop of push_card | convenience: array of cards + shared repeat/cooldown. This is the "push 50 Spanish cards once, bus drips them for weeks" move. |
| `create_lane` / `list_lanes` | POST/GET `/v1/channels` | lanes are private channels owned by the token's owner |
| `get_history` | GET `/v1/feed/history` | what was delivered + seen state — lets agents do spaced repetition without vibefeed building an SR engine |
| `get_feed_status` | GET `/health` + `/v1/me` | queue depth per lane, so agents don't overflood |

Tool descriptions are product surface: they must teach the agent the delivery semantics
(ambient vs must_see, recurring+cooldown, dedupe upsert) so "push a deck of X" works from a
one-sentence user prompt. Include 3 worked examples in each description.

## 7. Chrome extension changes

- **Auth:** already built — popup has Backend URL + Token fields and sends the bearer header when
  a token is set. Verify against the unified token resolution (T-10); no rework expected.
- **Onboarding:** first-run popup state links to the dashboard "connect" page which shows the
  token + a "copy MCP config" snippet.
- **Web Store:** new listing — name, 128px icon set (exist), screenshots, promo tile, privacy
  policy URL, and a justification of permissions. The privacy story is strong (never reads
  prompts/pages) — say it verbatim in the listing.
- Keep `demo.html` working — it's the no-install demo for HN.

## 8. Web (landing + dashboard)

Single small site served by the bus at `/`:

- **Landing:** the pitch, a 20-second looping demo (screen recording of a card appearing over
  Claude), three copy-paste examples of producer-in-a-sentence, install CTA.
- **Dashboard (session-auth'd):** token mint/revoke with copy buttons, ready-made MCP config
  snippet (`claude mcp add vibefeed …` + JSON for other clients), lanes list with mute, recent
  history, starter-channel toggles.
- **Docs page:** quickstart (5 steps), API reference (exists in README — lift it), self-host guide.

## 9. Onboarding flow (the <5 minute contract)

1. Land → "Start your feed" → magic link or Google → dashboard.
2. Dashboard shows: token (copy), extension install button (Web Store), MCP snippet (copy).
3. Install extension → paste backend URL + token → popup shows live preview card immediately
   (starter channels guarantee content exists).
4. Open claude.ai / chatgpt.com, send a prompt → card appears.
5. First producer moment (the aha): tell your agent —
   *"Add 20 cards teaching me basic Spanish greetings to my vibefeed, spaced over two weeks."*

Success criterion: a stranger completes 1–4 in under 5 minutes without reading docs.

## 10. Launch checklist (Show HN)

- Title: "Show HN: Vibefeed — your agents push to the seconds you spend waiting on AI"
- Assets: demo GIF (card over a thinking Claude), README overhaul leading with MCP example,
  `demo.html` link for zero-install skeptics, self-host quickstart above the fold.
- First comment (yours): the ads-vs-your-own-feed framing, privacy model, and the "push a deck
  once, bus drips it" trick — these are the three things HN will engage with.

## 11. Risks & open questions

- **Chrome Web Store review time** is the critical path — submit before the rest is polished.
- **Anti-goal creep:** no teams, no directory, no remote MCP in v0. Ship the loop.
- Open: production domain name; whether starter channels are on or off by default for new
  hosted users (recommend: on, with visible mute).
