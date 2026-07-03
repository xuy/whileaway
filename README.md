# whileaway

**While the AI thinks, skim one useful thing.** whileaway shows a small card in the corner of
ChatGPT / Claude / Perplexity / Gemini / etc. *the moment you send a prompt* — surfacing one item
from a feed you control, instead of an ad.

![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![backend](https://img.shields.io/badge/backend-Node%2020-3a86ff)
![extension](https://img.shields.io/badge/extension-MV3-7c6cff)

Under the hood it's **a message bus for glanceable cards**. The backend doesn't crawl the
internet — it *receives pushes*. Anyone with a publisher key can push items onto a **channel**;
you **subscribe** to the channels you want; a delivery engine shows you the single best card per
moment. Think *Telegram channels delivered as ambient cards* — broadcast you opted into, one at a
time, never a scroll.

## 🔒 Privacy first

whileaway **never reads your prompt, the AI's answer, page text, links, or citations.** The content
script only detects *that a generation started* (form submit / Enter / send-click / the AI's "stop"
button) and asks **your** backend for the next card. Nothing about the page leaves your browser. No
ads, no trackers, no account required. And because the only channels that can reach you are ones
*you subscribed to*, "someone pushes spam at me" isn't possible — mute or unsubscribe in one tap.

## How it works

```
producer (any client, with a key) ──push──▶  CHANNEL  ──┐
                                                          ├─▶ delivery engine ─▶ GET /v1/feed/next ─▶ card
you ──subscribe──▶ channels you chose ───────────────────┘
```

- **Channel** — a named stream with an owner and a visibility (`private` / `unlisted` / `public`).
- **Item** — pushed onto a channel, with delivery semantics: `priority`, `expires_at`,
  `repeat` (`once` | `recurring` + cooldown/max), `dedupe_key` (re-push upserts instead of
  duplicating), and a `class` (`ambient` shows once; `must_see` keeps surfacing until you've seen
  it — important, but never an interrupting notification).
- **Subscription** — your feed is the merge of channels you subscribe to. Your "personal" lane is
  just channel #1 (private).
- **Delivery engine** — drops expired, honors repeat/cooldown, dedupes, ranks by class+priority+
  recency, and round-robins across channels so no one channel floods you.

The default content (Wikipedia, Hacker News, RSS, a mock Personal lane) isn't the bus crawling —
it's **reference push-clients** in [`server/clients/`](server/clients) pushing into channels *we*
own, over the same public API any integrator would use.

```
whileaway/
├── server/
│   ├── src/          the bus: store · bus (delivery engine) · bootstrap · http
│   └── clients/      reference pushers (wikipedia · hackernews · rss · mock) + sources
├── extension/        MV3 Chrome extension (content script · proxy · popup)
└── LICENSE           Apache-2.0
```

## Quick start

### 1. Run the bus

```bash
cd server
cp .env.example .env       # optional — defaults work as-is
npm install
npm start
```

On boot it seeds default channels, auto-subscribes your local user, prints a **publisher key**, and
runs the bundled pushers in-process so the feed is populated immediately. Check it:
`curl localhost:4000/health`.

> Set `WHILEAWAY_KEY` in `.env` to a stable key (so external pushers survive restarts), or
> `RUN_DEFAULT_PUSHERS=0` to push only from your own clients (`npm run pushers` runs them standalone).

### 2. Load the extension

1. `chrome://extensions` → **Developer mode** → **Load unpacked** → select `extension/`.
2. Click the icon: backend status, **Channels** (subscribe / mute), a live **card preview**,
   history, and a **Show on this tab** test button. The **Backend** field points it at your server.
3. Open ChatGPT/Claude, **reload the tab once**, send a prompt → a card appears bottom-right.

No-install peek: open `extension/demo.html?base=http://localhost:4000` in any browser.

## API

**Consumer** (a user identity; open by default for local self-host):

| method | path | purpose |
|--------|------|---------|
| GET | `/v1/feed/next` | next card, or `204` when nothing's eligible |
| POST | `/v1/feed/seen` | `{ id }` → mark seen (history; stops `must_see` re-surfacing) |
| GET | `/v1/feed/history?limit=` | recently delivered |
| GET | `/v1/channels` | directory: channels you can see, with subscribe/mute state |
| POST | `/v1/subscriptions` | `{ channelId, action }` — `subscribe`/`unsubscribe`/`mute`/`unmute` |
| GET | `/v1/feed/config` | client display timings |

**Producer** (`Authorization: Bearer <publisher_key>`, scoped to channels you own):

| method | path | purpose |
|--------|------|---------|
| POST | `/v1/channels` | create/update a channel |
| POST | `/v1/channels/:id/items` | push an item |
| POST | `/v1/keys` | mint another publisher key for your owner |

Push an item:

```bash
curl -X POST localhost:4000/v1/channels/personal/items \
  -H "Authorization: Bearer $WHILEAWAY_KEY" -H "Content-Type: application/json" \
  -d '{
    "title": "Standup in 10 min",
    "body": "Daily · Google Meet",
    "url": "https://meet.google.com/...",
    "kind": "calendar",
    "dedupe_key": "cal:evt:abc",
    "delivery": { "class": "must_see", "priority": 90, "expires_at": "2026-06-22T10:30:00Z" }
  }'
```

## Write your own pusher

That's the whole point — whileaway stays out of the integration business; you push what you care
about. Create a channel once, then push to it on a cron from anywhere (a script, a Lambda, a
Shortcut). Anything that produces the item shape above works — your read-later queue, a Twitter
list you export, your home automation, a teammate's announcements. See
[`server/clients/runner.js`](server/clients/runner.js) for a ~40-line reference.

## Host it (optional)

It's just Node — run it anywhere. A `Dockerfile` and `fly.toml` are included for Fly.io (scales to
zero when idle). Paste your `https://<app>.fly.dev` into the popup's **Backend** field.

## Contributing

PRs welcome — a new reference pusher is the easiest start (one file in `server/clients/sources/`).
Keep the privacy stance intact: the bus never fetches page content, and consumers stay in full
control of what can reach them.

## License

[Apache-2.0](./LICENSE) © whileaway contributors.
