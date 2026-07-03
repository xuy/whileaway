// Tested one-sentence producer prompts (T-51). Each entry is the natural-language ask a user
// gives their agent, plus the exact whileaway-mcp call the agent makes. docs/EXAMPLES.md is
// generated from this list, and examples.test.js reproduces every one against a clean bus.
export const EXAMPLES = [
  {
    id: "spanish-deck",
    prompt: "Add cards teaching me basic Spanish greetings to my whileaway, spaced over two weeks.",
    note: "A recurring deck: each card resurfaces daily (cooldown 86400s) up to 14 times — spaced repetition without whileaway needing an SR engine.",
    tool: "push_deck",
    args: {
      lane: "spanish",
      cooldown_s: 86400,
      max: 14,
      cards: [
        { title: "hola — hello" },
        { title: "buenos días — good morning" },
        { title: "gracias — thank you" },
        { title: "por favor — please" },
        { title: "de nada — you're welcome" },
        { title: "¿cómo estás? — how are you?" },
      ],
    },
    expect: { count: 6 },
  },
  {
    id: "meeting-commitments",
    prompt: "Resurface the commitments I made in today's meetings until I act on them.",
    note: "class must_see keeps each card surfacing every idle moment until the user marks it seen — important, but never an interrupting notification.",
    tool: "push_deck",
    args: {
      lane: "commitments",
      class: "must_see",
      cards: [
        { title: "Send Dana the Q3 forecast", kind: "note" },
        { title: "Review the vendor contract by Thu", kind: "note" },
        { title: "Book the design review room", kind: "calendar" },
      ],
    },
    expect: { count: 3 },
  },
  {
    id: "meditations-quotes",
    prompt: "Drip me one quote from Marcus Aurelius every few hours.",
    note: "Recurring with a short cooldown and a small max — a gentle rotation rather than a one-off.",
    tool: "push_deck",
    args: {
      lane: "meditations",
      cooldown_s: 10800,
      max: 3,
      cards: [
        { title: "“You have power over your mind — not outside events.”" },
        { title: "“The happiness of your life depends upon the quality of your thoughts.”" },
        { title: "“Waste no more time arguing what a good man should be. Be one.”" },
      ],
    },
    expect: { count: 3 },
  },
  {
    id: "reading-list",
    prompt: "Queue these articles to skim while I'm waiting on the AI.",
    note: "Plain ambient cards: each shows once, and the bus drips them out one per idle moment.",
    tool: "push_deck",
    args: {
      lane: "reading",
      cards: [
        { title: "The Bitter Lesson", url: "https://example.com/bitter-lesson", kind: "article" },
        { title: "Situational Awareness", url: "https://example.com/situational", kind: "article" },
      ],
    },
    expect: { count: 2 },
  },
  {
    id: "standup-reminder",
    prompt: "Remind me about my 10am standup, and keep showing it until I've seen it.",
    note: "A single must_see calendar card with high priority so it ranks first.",
    tool: "push_card",
    args: { lane: "meetings", title: "Standup at 10:00 — Daily · Meet", kind: "calendar", class: "must_see", priority: 90 },
    expect: { id: true },
  },
  {
    id: "hydration",
    prompt: "Nudge me to drink water a few times a day.",
    note: "Recurring reminder with a daytime cooldown and a daily cap.",
    tool: "push_card",
    args: { lane: "health", title: "Sip some water 💧", repeat: { mode: "recurring", cooldown_s: 14400, max: 5 } },
    expect: { id: true },
  },
  {
    id: "deploy-status",
    prompt: "Show my current prod deploy status and update it in place on each deploy.",
    note: "dedupe_key makes re-pushes upsert the same card instead of stacking duplicates.",
    tool: "push_card",
    args: { lane: "deploys", title: "prod: v1.4.2 live ✅", dedupe_key: "prod-deploy", kind: "note" },
    expect: { id: true },
  },
  {
    id: "french-numbers",
    prompt: "Teach me the French numbers one through five, one a day.",
    note: "Another spaced-repetition deck — the same pattern generalizes to any micro-lesson.",
    tool: "push_deck",
    args: {
      lane: "french",
      cooldown_s: 86400,
      max: 5,
      cards: [
        { title: "un — one" },
        { title: "deux — two" },
        { title: "trois — three" },
        { title: "quatre — four" },
        { title: "cinq — five" },
      ],
    },
    expect: { count: 5 },
  },
  {
    id: "space-trivia",
    prompt: "Give me a random space fact to chew on between prompts.",
    note: "Ambient one-offs — a light, no-pressure feed.",
    tool: "push_deck",
    args: {
      lane: "space",
      cards: [
        { title: "A day on Venus is longer than its year." },
        { title: "Neutron star material: ~1 billion tons per teaspoon." },
        { title: "There are more trees on Earth than stars in the Milky Way." },
      ],
    },
    expect: { count: 3 },
  },
  {
    id: "team-deploy-preview",
    prompt: "Make a public lane previewing what a team's deploy-notes feed would look like.",
    note: "A public lane others can subscribe to — a glimpse of the team feature (v0.5), built on the same primitives with zero new API.",
    tool: "push_deck",
    args: {
      lane: "team-deploys",
      laneOpts: { visibility: "public", title: "Team Deploys" },
      cards: [
        { title: "api: v2.7 rolled to 100%", kind: "note" },
        { title: "web: hotfix for the login redirect", kind: "note" },
      ],
    },
    expect: { count: 2 },
  },
];
