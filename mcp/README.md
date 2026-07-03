# whileaway-mcp

An [MCP](https://modelcontextprotocol.io) server that turns any agent into a **whileaway producer**. Point it at your whileaway bus with a bearer token and your agent can push cards to your idle-moment feed in one sentence — *"push me a 20-card Spanish deck spaced over two weeks."*

It's a thin, stateless wrapper over the bus `/v1` API. All the delivery intelligence (ambient vs must_see, recurring cooldowns, dedupe upsert, round-robin fairness) lives in the bus.

## Configure

| env | default | meaning |
|-----|---------|---------|
| `WHILEAWAY_URL` | `http://localhost:4000` | Base URL of your whileaway bus |
| `WHILEAWAY_TOKEN` | — | Bearer token minted from the dashboard (or the self-host boot key) |
| `WHILEAWAY_LANE` | `personal` | Default lane when a tool call omits one |

### Claude Code

```bash
claude mcp add whileaway \
  --env WHILEAWAY_URL=https://your-bus.example.com \
  --env WHILEAWAY_TOKEN=vf_pk_… \
  -- npx -y whileaway-mcp
```

### Claude Desktop / Cursor (JSON)

```json
{
  "mcpServers": {
    "whileaway": {
      "command": "npx",
      "args": ["-y", "whileaway-mcp"],
      "env": { "WHILEAWAY_URL": "https://your-bus.example.com", "WHILEAWAY_TOKEN": "vf_pk_…" }
    }
  }
}
```

## Tools

| tool | what it does |
|------|--------------|
| `push_card` | Push one card to a lane (created if missing). |
| `push_deck` | Push many cards at once with a shared delivery config — the "push a deck, let the bus drip it out" move. |
| `create_lane` | Create/update a lane (private channel) explicitly. |
| `list_lanes` | List the lanes visible to you. |
| `get_history` | Recently delivered-and-seen cards (for an agent's own spaced repetition). |
| `get_feed_status` | Health + lane snapshot so an agent doesn't overflood a lane. |

Each tool's description teaches the delivery semantics with worked examples, so a one-sentence prompt is enough.

## Delivery semantics (what the agent should know)

- **`ambient`** (default) — a card shows once, then retires.
- **`must_see`** — resurfaces every idle moment until the user marks it seen. Important, but never an interrupting notification.
- **`repeat: { mode: "recurring", cooldown_s, max }`** — re-delivers on a cooldown, up to `max` times. This is how spaced repetition works.
- **`dedupe_key`** — re-pushing the same key to a lane upserts the existing card instead of duplicating it.

## Develop

```bash
npm install
npm test          # boots a local bus and drives the client + stdio server end-to-end
```
