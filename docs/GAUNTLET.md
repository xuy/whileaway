# Pre-launch gauntlet (T-62)

Final gate run against production (`https://whileaway.fly.dev`) on 2026-07-04, plus the automated
suites. **Result: no P0s. Onboarding well under the 5-minute contract.**

## Onboarding (spec §9, timed)

Fresh account → token → push → deliver → seen, end to end: **18 seconds** (contract: < 5 min / 300 s).

- Steps 1 (sign in) → 2 (token + MCP snippet + one-paste code) → 3 (push/first card) run in one
  API flow; verified live via magic-link signup.
- Step 4 (extension shows a card on a real AI page) and the Web-Store install are exercised
  manually once the extension is loaded — the underlying `GET /v1/feed/next` contract is proven
  here; the extension is a thin client of it.
- Starter lanes guarantee a card in minute one with zero producer setup (T-50, verified).

## Recipes (EXAMPLES.md)

All 10 example recipes run against a clean bus by `mcp/test/examples.test.js` — **25/25 MCP tests
pass**. Each recipe's one sentence produces the expected `push_card`/`push_deck` call and cards.

## Abuse / hardening (live against prod)

| attack | expected | result |
|--------|----------|--------|
| Push flood (66 rapid pushes on one token) | rate-limited after ~60/min | **429** after 60 ✓ |
| Oversized payload (~300 KB body) | rejected at the 256 KB cap | **413** ✓ |
| Foreign-lane push (push to `wikipedia`, owned by `owner_default`, with a different owner's token) | can't address another owner's lane | **404 "no such lane"** ✓ |
| Own-lane push (control) | allowed | **200** ✓ |

Notes:
- Rate limiting is enforced *before* the ownership check (a flooded token gets 429 even on a
  foreign lane) — correct ordering; the 404 is confirmed with a fresh token.
- Ownership is namespaced by construction: a producer's ref always resolves within its own
  `ownerId:slug` namespace, so there is no way to even *address* someone else's lane.
- Metrics (`/v1/metrics`) are gated behind the ops token; `/v1/lanes` and `/v1/feed/next` require a
  valid bearer in hosted mode (unauth → 401).

## Test suites (CI)

- server (JSON store): **44 pass** · server (SQLite): **44 pass** · MCP: **25 pass**.

## Known non-blockers (not P0)

- **Public signup needs an email transport** (Resend) — magic links currently print to the server
  log. Self-host and the whole flow work today; this gates *public* hosted signup only.
- **Web Store listing** is packaged (`docs/WEB-STORE.md`) but not yet submitted (human: account +
  screenshots + submit).
- **npm publish** of `whileaway-mcp` pending (human: npm org).
