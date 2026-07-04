# whileaway — example producer prompts

Ten one-sentence prompts you can hand your agent once `whileaway-mcp` is connected. Each shows the
tool call the agent makes and the cards it produces. Every example here is reproduced against a
clean instance by `mcp/test/examples.test.js` — the source of truth is `mcp/examples/examples.js`.

The trick that makes these one-liners work: whileaway owns all the delivery logic (ambient vs
must_see, recurring cooldowns, dedupe upsert), so the agent only has to translate intent into a
`push_card`/`push_deck` call — no scheduling engine, no follow-up questions.

---

### 1. Spanish greetings, spaced over two weeks
> "Add cards teaching me basic Spanish greetings to my whileaway, spaced over two weeks."

```js
push_deck({ lane: "spanish", cooldown_s: 86400, max: 14, cards: [
  { title: "hola — hello" }, { title: "buenos días — good morning" },
  { title: "gracias — thank you" }, { title: "por favor — please" },
  { title: "de nada — you're welcome" }, { title: "¿cómo estás? — how are you?" },
]})
```
Each card is **recurring** — it resurfaces about once a day, up to 14 times. Spaced repetition, no SR engine.

### 2. Resurface meeting commitments
> "Resurface the commitments I made in today's meetings until I act on them."

```js
push_deck({ lane: "commitments", class: "must_see", cards: [
  { title: "Send Dana the Q3 forecast" },
  { title: "Review the vendor contract by Thu" },
  { title: "Book the design review room", kind: "calendar" },
]})
```
**must_see** cards keep surfacing every idle moment until you mark them seen — present, never interrupting.

### 3. A quote every few hours
> "Drip me one quote from Marcus Aurelius every few hours."

```js
push_deck({ lane: "meditations", cooldown_s: 10800, max: 3, cards: [
  { title: "“You have power over your mind — not outside events.”" },
  { title: "“The happiness of your life depends upon the quality of your thoughts.”" },
  { title: "“Waste no more time arguing what a good man should be. Be one.”" },
]})
```

### 4. A reading list that drips out
> "Queue these articles to skim while I'm waiting on the AI."

```js
push_deck({ lane: "reading", cards: [
  { title: "The Bitter Lesson", url: "https://example.com/bitter-lesson", kind: "article" },
  { title: "Situational Awareness", url: "https://example.com/situational", kind: "article" },
]})
```
Plain **ambient** cards — each shows once; whileaway spreads them across many idle moments.

### 5. A standup reminder that sticks
> "Remind me about my 10am standup, and keep showing it until I've seen it."

```js
push_card({ lane: "meetings", title: "Standup at 10:00 — Daily · Meet", kind: "calendar", class: "must_see", priority: 90 })
```
High `priority` ranks it first; `must_see` keeps it up until acknowledged.

### 6. A gentle recurring nudge
> "Nudge me to drink water a few times a day."

```js
push_card({ lane: "health", title: "Sip some water 💧", repeat: { mode: "recurring", cooldown_s: 14400, max: 5 } })
```

### 7. A live status card, updated in place
> "Show my current prod deploy status and update it in place on each deploy."

```js
push_card({ lane: "deploys", title: "prod: v1.4.2 live ✅", dedupe_key: "prod-deploy" })
```
Re-pushing with the same `dedupe_key` **upserts** the card — the feed never fills with stale duplicates.

### 8. French numbers, one a day
> "Teach me the French numbers one through five, one a day."

```js
push_deck({ lane: "french", cooldown_s: 86400, max: 5, cards: [
  { title: "un — one" }, { title: "deux — two" }, { title: "trois — three" },
  { title: "quatre — four" }, { title: "cinq — five" },
]})
```

### 9. Ambient trivia
> "Give me a random space fact to chew on between prompts."

```js
push_deck({ lane: "space", cards: [
  { title: "A day on Venus is longer than its year." },
  { title: "Neutron star material: ~1 billion tons per teaspoon." },
  { title: "There are more trees on Earth than stars in the Milky Way." },
]})
```

### 10. A public lane (a glimpse of teams)
> "Make a public lane previewing what a team's deploy-notes feed would look like."

```js
push_deck({ lane: "team-deploys", laneOpts: { visibility: "public", title: "Team Deploys" }, cards: [
  { title: "api: v2.7 rolled to 100%" },
  { title: "web: hotfix for the login redirect" },
]})
```
Public lanes are the same primitive as private ones with one field flipped — the v0.5 team feature is just a shareable subscribe link away, with zero new API.

---

*Reproduce them all:* `npm test --prefix mcp` (see `test/examples.test.js`).
