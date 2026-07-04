# Chrome Web Store submission packet (T-30)

Everything needed to submit the whileaway extension. **Human steps** (Chrome dev account + one-time
$5 fee, capturing screenshots, clicking Submit) are marked ⚠️. Everything else is ready-to-paste.

## Package the extension

Before zipping, set the shipped defaults in `extension/src/config.js`: `VF_ENV = "prod"` (so a
fresh install points at `whileaway.fly.dev` out of the box) and confirm `VF_DEBUG = false` (no
console output on AI pages — already the default). Then zip the `extension/` directory (manifest at
the zip root):

```bash
cd extension
zip -r ../whileaway-extension.zip . -x '*.DS_Store'
```

`demo.html` can stay in the zip (harmless) or be excluded. Icons (16/48/128) are present.

## Listing fields (paste verbatim)

- **Name:** `whileaway`
- **Summary** (≤132 chars): `While an AI thinks, skim one useful thing — a card from the feed only you publish to. Never reads your prompts or the page.`
- **Category:** Productivity
- **Language:** English
- **Privacy policy URL:** `https://whileaway.fly.dev/privacy` *(live, verified 200)*

**Description:**

```
whileaway shows you one useful card in the seconds you'd otherwise spend waiting on an AI — a
card from a feed that only you can publish to.

Tell your AI agent one sentence ("push me one stoic quote each morning", "teach me Spanish,
spaced over two weeks") and it fills your feed over MCP. whileaway shows the single best card
per moment — while an AI is generating, or on a new tab. Not an ad. Not someone else's
algorithm. The one channel where only you reach you.

PRIVACY FIRST
whileaway never reads your prompts, the AI's answers, the pages you visit, or anything you type.
On supported AI sites it only detects THAT a response started generating (by watching for the
site's "stop" control) and then shows one card you or your agent chose. No page content is ever
read or transmitted. No analytics, no trackers, no ads.

YOUR FEED, YOUR SERVER
Point the extension at the hosted instance (whileaway.fly.dev) or self-host the open-source
backend — your data lives wherever you choose. Only you publish to your feed, so spam isn't
possible; mute or unsubscribe any lane in one tap.

Open source (Apache-2.0).
```

## Permission justifications (paste into each field)

- **`storage`:** "Stores your settings locally: the backend URL, an optional access token, and a
  random per-browser identifier that keeps your feed separate. Nothing else is stored; none of it
  leaves your device except requests to the backend you configure."
- **Host access to AI sites** (chatgpt.com, chat.openai.com, claude.ai, perplexity.ai,
  gemini.google.com, chat.mistral.ai, copilot.microsoft.com, chat.deepseek.com, grok.com):
  "To detect when the AI starts generating a response (by observing the presence of the site's
  'stop generating' control) and to render a small card overlay on the page. No page text,
  prompts, responses, or links are read or transmitted."
- **Host access to the backend** (`http://localhost:4000/*`, `https://whileaway.fly.dev/*`):
  "To fetch the user's next card and, optionally, push cards to the user's own feed."
- **New-tab override** (`chrome_url_overrides.newtab`): "Optional surface that shows the user's next
  card on the new-tab page. It renders only the user's own feed and reads no browsing data. Users
  who don't want it can disable the extension or use Chrome's new-tab controls."

## Data-use disclosures (Privacy practices form)

- Does the extension collect or use data? **The single purpose** is: *show the user cards from a
  feed they control, in the moments they wait on an AI.*
- Data collected: **none** beyond the locally-stored settings above. No PII, no web history, no
  user activity sent to us. Check **"I do not sell or transfer user data to third parties,"**
  **"...not use or transfer for purposes unrelated to the single purpose,"** and **"...not use or
  transfer to determine creditworthiness / lending."**

## Screenshots ⚠️ (capture these — 1280×800 or 640×400, PNG)

Load the extension unpacked (`chrome://extensions` → Load unpacked → `extension/`), point the
popup's Backend at `https://whileaway.fly.dev` (paste a setup code from the dashboard), then capture:

1. **The card overlay** — on claude.ai/chatgpt.com mid-generation, the card bottom-right. *(hero shot)*
2. **The new-tab page** — a card filling a fresh tab.
3. **The popup** — status, lanes with mute, live preview.
4. **The connect page** — token + one-paste setup code + MCP snippet (whileaway.fly.dev, signed in).
5. **The landing** — the thesis hero (whileaway.fly.dev logged out).

**Promo tile (440×280):** the whileaway gradient logo + the line *"The feed only you can publish to."*

## Submit ⚠️

1. Chrome Web Store Developer Dashboard → pay the one-time $5 registration fee (if new).
2. **New item** → upload `whileaway-extension.zip`.
3. Paste the listing fields, description, permission justifications, privacy URL above.
4. Upload the 5 screenshots + promo tile.
5. Complete the Privacy practices form (disclosures above).
6. **Submit for review.** Web Store review is days-to-weeks — submit early; iterate on any
   rejection as a fast follow-up.

## Notes

- The privacy story is the strongest selling point — it leads the listing on purpose.
- Store review sometimes flags broad host permissions and new-tab overrides; the justifications
  above address both head-on. If asked to narrow host permissions, we can drop unused AI sites.
