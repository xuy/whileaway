# whileaway v0 — Work Breakdown (agent-ready)

Companion to `V0-SPEC.md`. Each task card is sized to be handed to a coding agent as a single
overnight run: self-contained brief, explicit acceptance criteria, and no hidden context — the
agent should need only this file, the spec, and the repo.

## How to run this plan

- One task = one agent run = one PR. Keep runs independent; merge order follows the dependency
  column.
- Every brief should start: *"Read docs/V0-SPEC.md and docs/V0-PLAN.md, then complete task T-N.
  Follow the team-readiness rules in spec §3. Do not expand scope."*
- **Critical path: T-30 (Web Store submission).** Start WS3 the moment T-31 merges; store review
  is days-to-weeks and everything else can proceed in parallel.
- Human-only tasks (you): domain purchase, Google OAuth credentials, Chrome developer account,
  npm org, Fly/Railway account, launch post submission.

## Dependency graph (workstream level)

```
WS0 foundations ─▶ WS1 server ─▶ WS2 mcp ──▶ WS5 content/examples ─▶ WS6 launch
                        │            ▲
                        ├─▶ WS3 extension (T-30 submit EARLY)
                        └─▶ WS4 web/dashboard
```

---

## WS0 — Foundations

**T-01 · Test harness + CI** — deps: none
Add a test runner (node:test), smoke tests for the existing bus (push → next → seen → history;
repeat/cooldown; must_see re-surfacing; dedupe upsert), and a GitHub Actions workflow running
them on PR. *Accept:* CI green on main; the delivery-engine behaviors in `bus.js` are pinned by
tests before anyone modifies them.

**T-02 · Storage driver seam** — deps: T-01
Refactor `store.js` into a driver interface with the current JSON-file implementation behind it.
No behavior change. *Accept:* all T-01 tests pass unmodified; `WHILEAWAY_STORE=json` explicit.

## WS1 — Server

**T-10 · Unified bearer-token resolution** — deps: T-01
One middleware: `Authorization: Bearer <token>` → `{ userId, ownerId, scopes }`. Extend key
records in the store with `userId` + `scopes`. Consumer routes use `userId`, producer routes use
`ownerId` + scope check. `AUTH_MODE=none` preserves today's behavior exactly (header identity,
boot key). *Accept:* self-host flow byte-identical; a minted token both pulls a feed and pushes
to owned lanes; spec §3 rule 1 respected (no field merging in store).

**T-11 · SQLite driver** — deps: T-02
`better-sqlite3` implementation of the driver seam; migration script from a JSON state file;
env-selected. *Accept:* full test suite passes on both drivers; 10k-card synthetic load survives
restart.

**T-12 · Better Auth integration (hosted mode)** — deps: T-10
Email magic link + Google sign-in, sessions for dashboard routes only. Signup hook: create
owner+user, mint god-token, create "Personal" lane, subscribe to starter lanes. New
endpoints: `POST /v1/tokens` (mint/revoke, session-auth'd), `GET /v1/me`. *Accept:* fresh signup
→ `/v1/me` shows lane + token; `AUTH_MODE=none` untouched; no passwords stored anywhere.

**T-13 · Rate limits + caps** — deps: T-10
Per-token push limit, per-user pull limit, lane count cap, per-user card cap; 429 with
Retry-After. *Accept:* tests prove limits; normal single-user usage never trips them.

**T-14 · Production deploy** — deps: T-11, T-12, T-13 · human-assisted (accounts, domain, DNS)
A Fly host (`whileaway-bus.fly.dev`) is already referenced in the extension manifest — build on
it: volume for SQLite, HTTPS, custom domain, env docs, deploy runbook in `docs/DEPLOY.md`.
*Accept:* hosted instance live on the production domain; signup → card in extension works
end-to-end against it.

## WS2 — MCP server

**T-20 · `whileaway-mcp` package** — deps: T-10
New `mcp/` workspace: stdio MCP server (`@modelcontextprotocol/sdk`), tools exactly per spec §6
(`push_card`, `push_deck`, `create_lane`, `list_lanes`, `get_history`, `get_feed_status`).
Tool descriptions must teach delivery semantics with 3 worked examples each — treat description
text as product surface, not boilerplate. *Accept:* `npx whileaway-mcp` against a local bus; a
Claude Code session with only the one-sentence prompt *"push a 20-card Spanish greetings deck to
my whileaway, spaced over two weeks"* produces a correctly-repeating deck without follow-up
questions.

**T-21 · Publish + client configs** — deps: T-20 · human-assisted (npm org)
Publish to npm; README with config snippets for Claude Code, Claude Desktop, Cursor; version the
API base path. *Accept:* `claude mcp add whileaway …` from README works verbatim.

## WS3 — Chrome extension  ⚠️ critical path

**T-31 · First-run onboarding polish** — deps: T-10
Token field + bearer header already exist in the popup — verify against T-10's unified
resolution, then build the first-run state: short explainer + link to the dashboard connect page
+ live preview once configured. *Accept:* works against both hosted and `AUTH_MODE=none`
backends; preview card renders within 5s of pasting a valid token.

**T-30 · Web Store submission** — deps: T-31 · human-assisted (dev account, $5 fee)
Listing copy (lead with the privacy model, verbatim from README), screenshots, promo tile,
privacy policy page URL, permission justifications. Submit for review immediately — iterate on
rejection feedback as its own follow-up runs. *Accept:* submitted; listing draft reviewed by you;
rejection responses turned around within 24h.

**T-32 · Trigger-site hardening** — deps: none (parallel)
The manifest already targets nine sites (chatgpt.com + chat.openai.com, claude.ai, gemini,
perplexity ×2, copilot, grok, deepseek, mistral). Verify generation-start detection on each
site's current DOM; fix drift; add a `docs/SITES.md` matrix with detection method per site.
*Accept:* manual checklist passes on at least the big four (chatgpt, claude, gemini, perplexity);
detection failures degrade silently (no console spam, no card).

## WS4 — Web (landing + dashboard)

**T-40 · Dashboard** — deps: T-12
Extend `server/public`: session login, token mint/revoke with copy buttons, MCP config snippet
generator (Claude Code / Desktop / Cursor / raw JSON), lanes with mute toggles, recent history,
starter-lane toggles. Plain HTML/JS like the existing console — no framework. *Accept:* the
spec §9 flow steps 1–3 complete in under 3 minutes using only the dashboard.

**T-41 · Landing page + docs** — deps: T-40
The pitch, demo GIF slot, three producer-in-a-sentence examples, install CTA, quickstart page,
self-host guide, privacy policy page (required by T-30 — write early and link). *Accept:* a
cold reader can explain what whileaway does after 30 seconds on the page.

## WS5 — Content & examples

**T-50 · Starter lanes on hosted** — deps: T-14
Run the existing reference pushers (wikipedia/HN/RSS) against the hosted bus on a schedule;
new-user auto-subscribe (per spec §11: on by default, mute visible). *Accept:* a brand-new
account sees a card on first prompt with zero producer setup.

**T-51 · Example producer prompts** — deps: T-20
`docs/EXAMPLES.md`: 8–10 tested one-sentence prompts (Spanish deck, "resurface my meeting
commitments", quotes from a book, team-deploy-notes preview of the future, etc.), each with the
exact cards it generated. These double as launch-post material. *Accept:* every example
reproduced against a clean account.

## WS6 — Launch

**T-60 · README overhaul** — deps: T-21, T-41
Lead with the MCP one-sentence-producer example; hosted quickstart above self-host; keep the
API tables; add architecture diagram from spec §4. *Accept:* you'd be proud to see it at the top
of HN.

**T-61 · Demo GIF + Show HN draft** — deps: T-50 · human-assisted (recording, submission)
20-second capture: prompt sent on claude.ai → card slides in → tap → history. Show HN title per
spec §10, your first comment drafted (ads framing, privacy model, deck-drip trick). *Accept:*
GIF under 5MB, plays in README; post draft reviewed.

**T-62 · Pre-launch gauntlet** — deps: everything
Fresh machine, fresh account: complete spec §9 steps 1–5 timed; run all EXAMPLES.md prompts;
attempt basic abuse (push flood, oversized payloads, foreign-lane push). *Accept:* <5 min
onboarding confirmed; no P0s open.

---

## Suggested overnight batching

| night | runs (parallel) |
|-------|-----------------|
| 1 | T-01 → T-02, T-32 |
| 2 | T-10, T-11 |
| 3 | T-12, T-13, T-20 |
| 4 | T-31 (then you submit T-30), T-21, T-40 |
| 5 | T-14 (with you), T-41, T-50 |
| 6 | T-51, T-60 |
| 7 | T-61, T-62, buffer for Web Store review feedback |

Web Store review is the only calendar card you don't control — everything else is ~a week of
agent-nights plus your human-only tasks (domain, OAuth creds, dev accounts, the recording, and
pressing submit on HN).
