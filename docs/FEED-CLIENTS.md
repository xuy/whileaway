# The feed-client contract

> Your feed is an API, not an app.

Every whileaway surface — the browser overlay, the new-tab page, the dashboard, an RSS bridge, a
future native app — is the **same client** implementing one tiny contract. Nothing about a surface
is privileged; they all just read one feed over HTTP. This document is that contract, so "surface
#1 of N" is a fact, not a slogan.

## Identity

A client acts as one **reader**. How it proves who it is depends on the server's mode:

- **Hosted** (`AUTH_MODE=hosted`): send `Authorization: Bearer <token>`. The token carries a
  `read:feed` scope and resolves to the reader. The `X-Whileaway-User` header is ignored (untrusted).
- **Self-host** (`AUTH_MODE=none`): send `X-Whileaway-User: <stable-id>` — any stable per-client
  string (a random UUID kept in local storage). Each id gets its own feed, subscriptions, history.

A client picks up its config once (backend URL + token) and reuses it. The dashboard emits a
one-paste `wa1:<base64 {url,token}>` setup code to make that trivial.

## The three verbs

| method | path | effect |
|--------|------|--------|
| `GET` | `/v1/feed/next` | **Deliver** the single best eligible card, or `204` if none. **Mutating** — records a delivery, advances round-robin fairness, and (for `once` ambient cards) consumes it. Rate-limited per reader. |
| `GET` | `/v1/feed/peek` | **Preview** the card `next` *would* return, or `204`. **Non-mutating** — never records a delivery. Use it to show "what's coming" without burning a one-shot card. |
| `POST` | `/v1/feed/seen` | Body `{ "id": "<cardId>" }`. Marks the card acknowledged: moves it into history and stops a `must_see` card from re-surfacing. Idempotent. |

Two supporting reads:

| method | path | effect |
|--------|------|--------|
| `GET` | `/v1/feed/history?limit=N` | `{ cards: [...] }` — recently seen cards, newest first. Powers "is it working?" views. |
| `GET` | `/v1/feed/config` | `{ cooldownMs, minVisibleMs, displayMs, authMode }` — display timings a client may honor. |

## The card

`next`/`peek` return one card:

```json
{
  "id": "card_…",
  "laneId": "ownerId:slug",
  "sourceLabel": "Spanish",
  "accent": "#7c6cff",
  "kind": "note|article|discussion|calendar|email|event",
  "title": "buenos días — good morning",
  "body": "…optional supporting line…",
  "url": "https://… (optional click-through)",
  "imageUrl": "https://… (optional)",
  "class": "ambient|must_see",
  "ts": "2026-07-04T…Z"
}
```

A client renders `title` (+ optional `body`/`imageUrl`/`url`), tinted by `accent`. That's it.

## The delivery rule a client chooses

The server owns *what* is eligible (spacing, cooldowns, expiry, `must_see` re-surfacing,
round-robin). A client only chooses **when** to pull and **when** to mark seen:

- **Deliver-on-moment** (overlay, new-tab): call `next` when a found-moment happens (an AI starts
  generating; a new tab opens), then `POST /seen` after a real on-screen dwell — so the seen-rate
  reflects genuine attention, not accidental pulls.
- **Preview-only** (popup preview): call `peek` so opening a UI never consumes a card.
- **Read-only** (RSS, dashboard history): never call `next`/`seen`; render `history` or a lane feed.

## Reference clients (all in this repo)

| client | surface | how it uses the contract |
|--------|---------|--------------------------|
| `extension/src/content.js` | Browser overlay on AI sites | detects generation start → `next` → renders overlay → `seen` after display |
| `extension/src/newtab.js` | New-tab page | on every new tab → `next` → renders → `seen` after a 3.5s dwell |
| `server/public/app.js` | Dashboard "is it working?" | `history` (+ mints the token, emits the setup code) |
| `extension/demo.html` | No-install demo | `next` against a chosen backend — zero install |
| `GET /v1/lanes/:id/feed.xml` | RSS/Atom out | a *server-side* read client: renders a lane's cards as Atom for any RSS reader |

## Build your own

Any surface that can make an HTTP GET can be a whileaway client: a menubar app, a smart display, a
terminal `curl` loop, a Raspberry Pi e-ink frame. Implement the three verbs above and you're done —
the feed doesn't care what renders it.

```sh
# the whole client, in one line (self-host):
curl -s localhost:4000/v1/feed/next -H "X-Whileaway-User: my-fridge"
```
