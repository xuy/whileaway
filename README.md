# whileaway

**The feed only you can publish to.** One feed where only *you* reach you — filled by your own
AI/MCP agent, one sentence at a time. You skim it in the seconds you'd otherwise spend waiting on
an AI. Not an ad, not someone else's algorithm.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![backend](https://img.shields.io/badge/backend-Node%2020-3a86ff)
![extension](https://img.shields.io/badge/extension-MV3-7c6cff)

Tell your agent *"push me one stoic quote each morning"* or *"teach me Spanish, spaced over two
weeks"* and it fills a **lane** in your feed. A delivery engine shows you the single best **card**
per moment — spaced, deduped, expiring on cue. You read it wherever you are: a card in the corner
while an AI thinks, a new browser tab, an RSS reader, the dashboard.

**Your feed is an API, not an app.** Every surface is a thin client of one endpoint
(`GET /v1/feed/next`) — see [`docs/FEED-CLIENTS.md`](docs/FEED-CLIENTS.md).

### Privacy
whileaway **never reads your prompts, the AI's answers, page text, or links.** The extension only
detects *that* a generation started and asks **your** feed for the next card. No trackers, no ads.
And because only you (via your agent) publish to your feed, "someone spams me" isn't a thing.

## Why now

Person-controls-their-inputs already existed — it was RSS. It lost to algorithmic feeds on *labor*,
not ideology: curating your own inputs was work, and platforms made passivity free. Your agent now
does that labor. Filling your own feed used to cost effort per card; with MCP it costs one sentence
per *intent*. The idea was right for twenty years and only became practical about eighteen months
ago.

## Recipes

A **recipe** is the sentence you hand your agent. Copy one:

- *"Add cards teaching me basic Spanish greetings to my whileaway, spaced over two weeks."*
- *"Resurface the commitments I made in today's meetings until I act on them."*
- *"Drip me one quote from Marcus Aurelius every few hours."*
- *"Queue these articles to skim while I'm waiting on the AI."*
- *"Remind me about my 10am standup, and keep showing it until I've seen it."*

More, with the exact tool calls they produce, in [`docs/EXAMPLES.md`](docs/EXAMPLES.md).

## Quickstart (self-host)

It's just Node — your feed lives entirely on your own machine.

```bash
cd server
npm install
npm start            # seeds starter lanes, prints your key, runs reference pushers
curl localhost:4000/health
```

Then load the extension: `chrome://extensions` → **Developer mode** → **Load unpacked** →
select `extension/`. Open the popup, confirm the backend is `http://localhost:4000`, open an AI
chat, send a prompt → a card appears. (No install? Open `extension/demo.html?base=http://localhost:4000`.)

## Or use the hosted instance

**[whileaway.honestapp.org](https://whileaway.honestapp.org)** — sign in with a magic link; the connect
page hands you a token, a one-paste extension setup code, and your MCP snippet.

## Connect your agent (MCP)

`whileaway-mcp` is a thin stdio MCP server exposing `push_card` / `push_deck` / `create_lane` /
`list_lanes` / `get_history` / `get_feed_status`. Point it at your feed:

```bash
claude mcp add whileaway \
  -e WHILEAWAY_URL=http://localhost:4000 \
  -e WHILEAWAY_TOKEN=<your-key> \
  -- npx -y whileaway-mcp
```

Then just talk to your agent — the tool descriptions teach it the delivery semantics, so a
one-sentence recipe becomes the right `push_deck` call with no scheduling engine on your side.

## How it works

- **Lane** — a named division of your feed you own (`private` / `unlisted` / `public`).
- **Card** — pushed onto a lane, with delivery semantics: `priority`, `expires_at`,
  `repeat` (`once` | `recurring` + cooldown/max), `dedupe_key` (re-push upserts), and a `class`
  (`ambient` shows once; `must_see` re-surfaces until seen — present, never an interrupting notification).
- **Delivery engine** — drops expired, honors repeat/cooldown, dedupes, ranks by
  class+priority+recency, and round-robins across lanes so none floods you.
- **Starter lanes** (Wikipedia, Hacker News, RSS) are optional public lanes, auto-subscribed so the
  feed is alive in minute one — filled by **reference pushers** in
  [`server/clients/`](server/clients) over the same public API any integrator uses.

## API

**Consumer** (identity via bearer token, or `X-Whileaway-User` header when self-hosting):

| method | path | purpose |
|--------|------|---------|
| GET | `/v1/feed/next` | deliver the next card, or `204` |
| GET | `/v1/feed/peek` | preview the next card (non-consuming) |
| POST | `/v1/feed/seen` | `{ id }` → mark seen |
| GET | `/v1/feed/history?limit=` | recently seen cards |
| GET | `/v1/lanes` | lanes you can see, with subscribe/mute state |
| POST | `/v1/subscriptions` | `{ laneId, action }` — subscribe / unsubscribe / mute / unmute |
| GET | `/v1/lanes/:id/feed.xml` | a lane as an RSS/Atom feed |

**Producer** (`Authorization: Bearer <token>`, scoped to lanes you own):

| method | path | purpose |
|--------|------|---------|
| POST | `/v1/lanes` | create/update a lane |
| POST | `/v1/lanes/:id/cards` | push a card |
| POST | `/v1/tokens` | (session) mint a bearer token · `/v1/keys` mints another for the same owner |

```bash
curl -X POST localhost:4000/v1/lanes/personal/cards \
  -H "Authorization: Bearer $WHILEAWAY_KEY" -H "Content-Type: application/json" \
  -d '{"title":"Standup in 10 min","body":"Daily · Google Meet","kind":"calendar",
       "delivery":{"class":"must_see","priority":90}}'
```

## Architecture

```
                       hosted: whileaway.honestapp.org            self-host: localhost:4000
┌─────────────┐  MCP (stdio)  ┌──────────────────────────────────────────┐
│ Claude/agent│──────────────▶│  whileaway-mcp  ──HTTP──▶  server (Express)│
└─────────────┘   push_card   └──────────────────────────────────────────┘
                                     ▲                        │
┌─────────────┐  GET /v1/feed/next   │        SQLite (hosted) │ JSON file (self-host)
│ any surface │──────────────────────┘
└─────────────┘  overlay · new-tab · dashboard · RSS · your own
```

`server/` (delivery engine + HTTP), `mcp/` (the MCP server), `extension/` (MV3: overlay + new-tab +
popup), `server/public/` (landing + connect page). Deploy runbook: [`docs/DEPLOY.md`](docs/DEPLOY.md).

## Contributing

A new reference pusher is the easiest start (one file in `server/clients/sources/`). Keep the
privacy stance intact: the server never fetches page content, and only you publish to your feed.

## License

[Apache-2.0](./LICENSE) © whileaway contributors.
