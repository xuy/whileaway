#!/usr/bin/env node
// whileaway-mcp — a stdio MCP server that lets any agent push cards to a whileaway feed.
//
// Config (env): WHILEAWAY_URL (default http://localhost:4000), WHILEAWAY_TOKEN (bearer token
// from the dashboard), WHILEAWAY_LANE (default lane id, default "personal").
//
// The tool descriptions below are PRODUCT SURFACE, not boilerplate: they must teach the agent
// the delivery semantics so a one-sentence user request ("push me a Spanish deck over two weeks")
// produces correct cards with no follow-up questions.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { WhileawayClient } from "./client.js";

const client = new WhileawayClient();
const ok = (obj) => ({ content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] });
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `Error: ${e.message}${e.status ? ` (HTTP ${e.status})` : ""}` }] });

// Shared zod fragments -------------------------------------------------------
const repeatShape = z
  .object({
    mode: z.enum(["once", "recurring"]).describe("`once` = show a single time; `recurring` = resurface on a cooldown."),
    cooldown_s: z.number().int().positive().optional().describe("Seconds between recurring deliveries (e.g. 86400 = daily)."),
    max: z.number().int().positive().optional().describe("Cap on total deliveries for a recurring card."),
  })
  .optional();

const cardShape = {
  title: z.string().describe("Card headline — the whole glanceable payload. Keep it short."),
  body: z.string().optional().describe("One supporting line shown under the title."),
  url: z.string().url().optional().describe("Click-through link (http/https)."),
  image_url: z.string().url().optional().describe("Optional thumbnail (http/https)."),
  kind: z.enum(["note", "article", "discussion", "calendar", "email", "event"]).optional().describe("Drives the card accent/icon."),
  priority: z.number().int().min(0).max(100).optional().describe("0–100; higher ranks earlier in the feed. Default 50."),
  class: z.enum(["ambient", "must_see"]).optional().describe("`ambient` shows once then retires (default). `must_see` keeps resurfacing until the user marks it seen — important, but never an interrupting notification."),
  expires_at: z.string().optional().describe("ISO 8601. The card is dropped if not delivered by then."),
  repeat: repeatShape,
  dedupe_key: z.string().optional().describe("Re-pushing the same key to a lane UPSERTS the existing card (refreshes content, keeps its seen state) instead of creating a duplicate."),
};

const server = new McpServer({ name: "whileaway-mcp", version: "0.1.0" });

// push_card -----------------------------------------------------------------
server.registerTool(
  "push_card",
  {
    title: "Push one card",
    description: [
      "Push a single card to a whileaway lane (a private channel). The lane is created if it doesn't exist.",
      "",
      "Delivery semantics you control:",
      "- class `ambient` (default): shown once, then retires. Use for one-off items.",
      "- class `must_see`: resurfaces every idle moment until the user marks it seen. Use for time-sensitive nudges — not an interrupting notification.",
      "- repeat `{mode:'recurring', cooldown_s, max}`: re-delivers on a cooldown up to `max` times. Use for spaced repetition.",
      "- dedupe_key: re-pushing the same key upserts the existing card instead of duplicating.",
      "",
      "Examples:",
      "1) Quick reminder that nags until acknowledged:",
      "   push_card({title:'Standup in 10 min', body:'Daily · Meet', kind:'calendar', class:'must_see', priority:90})",
      "2) A daily vocabulary card that repeats for a week:",
      "   push_card({lane:'spanish', title:'hola = hello', repeat:{mode:'recurring', cooldown_s:86400, max:7}})",
      "3) An idempotent status card refreshed in place each deploy:",
      "   push_card({lane:'deploys', title:'prod: v1.4.2 live', dedupe_key:'prod-deploy', class:'ambient'})",
    ].join("\n"),
    inputSchema: { lane: z.string().optional().describe("Lane id. Created if missing. Defaults to your Personal lane."), ...cardShape },
  },
  async (args) => {
    try { return ok(await client.pushCard(args)); } catch (e) { return fail(e); }
  },
);

// push_deck -----------------------------------------------------------------
server.registerTool(
  "push_deck",
  {
    title: "Push a deck of cards",
    description: [
      "Push many cards to one lane in a single call, with a shared delivery config each card may override.",
      "This is the 'push 50 cards once, let the bus drip them out over weeks' move: the feed shows one card per idle moment, so a big ambient deck naturally spreads across many sessions.",
      "For spaced repetition, give the deck a recurring `repeat` (or `cooldown_s`/`max`) so every card resurfaces on that cadence.",
      "",
      "Examples:",
      "1) 20 Spanish greetings spaced as daily spaced-repetition over ~two weeks:",
      "   push_deck({lane:'spanish', repeat:{mode:'recurring', cooldown_s:86400, max:14}, cards:[{title:'hola = hello'}, {title:'gracias = thank you'}, ...]})",
      "2) A one-time reading list that drips out ambiently, newest first:",
      "   push_deck({lane:'reading', cards:[{title:'Article A', url:'https://…'}, {title:'Article B', url:'https://…'}]})",
      "3) Book quotes, one resurfacing every few hours up to 3 times each:",
      "   push_deck({lane:'quotes', cooldown_s:10800, max:3, cards:[{title:'“…” — Author'}, {title:'“…” — Author'}]})",
    ].join("\n"),
    inputSchema: {
      lane: z.string().optional().describe("Lane id for the whole deck. Created if missing. Defaults to your Personal lane."),
      cards: z.array(z.object(cardShape)).min(1).describe("The cards to push. Per-card fields override the shared config."),
      class: z.enum(["ambient", "must_see"]).optional().describe("Shared class applied to every card unless the card sets its own."),
      repeat: repeatShape,
      cooldown_s: z.number().int().positive().optional().describe("Shorthand: shared recurring cooldown for the whole deck (implies recurring)."),
      max: z.number().int().positive().optional().describe("Shorthand: shared max deliveries per card (implies recurring)."),
    },
  },
  async (args) => {
    try { return ok(await client.pushDeck(args)); } catch (e) { return fail(e); }
  },
);

// create_lane ---------------------------------------------------------------
server.registerTool(
  "create_lane",
  {
    title: "Create a lane",
    description: [
      "Create (or update) a lane — a private channel you own. Usually you don't need this: push_card/push_deck auto-create a lane. Use it to set a lane's title, description, kind, or visibility up front.",
      "Visibility: `private` (only you, default), `unlisted`, or `public` (appears in the shared directory).",
      "",
      "Examples:",
      "1) A private lane for language learning:",
      "   create_lane({lane:'spanish', title:'Spanish', description:'Daily vocab', kind:'note'})",
      "2) A public lane others can subscribe to:",
      "   create_lane({lane:'daily-quote', title:'Daily Quote', visibility:'public'})",
      "3) A calendar-styled lane for meeting nudges:",
      "   create_lane({lane:'meetings', title:'Meetings', kind:'calendar', accent:'#7c6cff'})",
    ].join("\n"),
    inputSchema: {
      lane: z.string().describe("Lane id (slug)."),
      title: z.string().optional(),
      description: z.string().optional(),
      kind: z.enum(["note", "article", "discussion", "calendar", "email", "event"]).optional(),
      visibility: z.enum(["private", "unlisted", "public"]).optional(),
      accent: z.string().optional().describe("Hex color like #7c6cff."),
      icon: z.string().optional(),
    },
  },
  async (args) => {
    try { return ok(await client.createLane(args)); } catch (e) { return fail(e); }
  },
);

// list_lanes ----------------------------------------------------------------
server.registerTool(
  "list_lanes",
  {
    title: "List lanes",
    description: [
      "List the lanes visible to you (owned, subscribed, and public), with their ids, titles, visibility, and subscription state.",
      "Use it before pushing to pick or confirm a lane id.",
      "",
      "Examples:",
      "1) See everything: list_lanes()",
      "2) Then push to one you found: push_card({lane:'<id from the list>', title:'…'})",
      "3) Confirm a lane you just created shows up: create_lane({lane:'x'}) → list_lanes()",
    ].join("\n"),
    // No inputSchema: this tool takes no arguments (an empty {} confuses the SDK validator).
  },
  async () => {
    try { return ok({ lanes: await client.listLanes() }); } catch (e) { return fail(e); }
  },
);

// get_history ---------------------------------------------------------------
server.registerTool(
  "get_history",
  {
    title: "Get delivery history",
    description: [
      "Return recently delivered-and-seen cards (newest first). Lets an agent do its own spaced repetition or avoid repeating content — whileaway itself has no SR engine.",
      "",
      "Examples:",
      "1) Last 20 seen cards: get_history({limit:20})",
      "2) Check whether today's vocab already went out before pushing more.",
      "3) Summarize what the user has seen this week from a given lane.",
    ].join("\n"),
    inputSchema: { limit: z.number().int().positive().max(200).optional().describe("Max entries (default 50).") },
  },
  async (args) => {
    try { return ok({ items: await client.getHistory(args?.limit) }); } catch (e) { return fail(e); }
  },
);

// get_feed_status -----------------------------------------------------------
server.registerTool(
  "get_feed_status",
  {
    title: "Get feed status",
    description: [
      "Return a health/status snapshot: overall counts and the lane list, so an agent can gauge how full the feed is before pushing more (don't overflood a lane).",
      "",
      "Examples:",
      "1) get_feed_status() before a big push_deck to see current item counts.",
      "2) Confirm the bus is reachable and the token works.",
      "3) List lanes + counts to decide which lane is underfilled.",
    ].join("\n"),
    // No inputSchema: this tool takes no arguments (an empty {} confuses the SDK validator).
  },
  async () => {
    try { return ok(await client.getFeedStatus()); } catch (e) { return fail(e); }
  },
);

// boot ----------------------------------------------------------------------
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Never write to stdout — that channel is the MCP protocol. Diagnostics go to stderr.
  console.error(`[whileaway-mcp] ready → ${process.env.WHILEAWAY_URL || "http://localhost:4000"}`);
}
main().catch((e) => {
  console.error("[whileaway-mcp] fatal:", e.message);
  process.exit(1);
});
