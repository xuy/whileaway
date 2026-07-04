// Thin HTTP client over the whileaway bus /v1 API. No state, no intelligence — it just shapes
// requests. The MCP server (index.js) is a transport wrapper around this; tests drive it directly
// against a live bus.
const DEFAULT_BASE = process.env.WHILEAWAY_URL || "http://localhost:4000";
const DEFAULT_TOKEN = process.env.WHILEAWAY_TOKEN || "";
const DEFAULT_LANE = process.env.WHILEAWAY_LANE || "personal";

export class WhileawayClient {
  constructor({ base = DEFAULT_BASE, token = DEFAULT_TOKEN, defaultLane = DEFAULT_LANE } = {}) {
    this.base = String(base).replace(/\/$/, "");
    this.token = token;
    this.defaultLane = defaultLane;
  }

  async _req(method, path, body) {
    const headers = { "Content-Type": "application/json" };
    if (this.token) headers.Authorization = "Bearer " + this.token;
    const res = await fetch(this.base + path, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    let data = null;
    if (res.status !== 204) { try { data = await res.json(); } catch { /* empty/non-json */ } }
    if (!res.ok) {
      const e = new Error((data && data.error) || `${method} ${path} → HTTP ${res.status}`);
      e.status = res.status; e.body = data;
      throw e;
    }
    return { status: res.status, data };
  }

  // --- lanes ---------------------------------------------------------------
  async createLane({ lane, title, description, kind, visibility, icon, accent } = {}) {
    if (!lane) throw new Error("lane id is required");
    const body = { id: lane, title: title || lane };
    if (description != null) body.description = description;
    if (kind != null) body.kind = kind;
    if (visibility != null) body.visibility = visibility;
    if (icon != null) body.icon = icon;
    if (accent != null) body.accent = accent;
    const { data } = await this._req("POST", "/v1/lanes", body);
    return data.lane;
  }

  async listLanes() {
    const { data } = await this._req("GET", "/v1/lanes");
    return data.lanes || [];
  }

  // --- cards ---------------------------------------------------------------
  buildCardBody(card) {
    if (!card || !card.title) throw new Error("card needs a title");
    const body = { title: card.title };
    if (card.body != null) body.body = card.body;
    if (card.url != null) body.url = card.url;
    if (card.image_url != null) body.image_url = card.image_url;
    if (card.kind != null) body.kind = card.kind;
    if (card.dedupe_key != null) body.dedupe_key = card.dedupe_key;
    const delivery = {};
    if (card.class != null) delivery.class = card.class;
    if (card.priority != null) delivery.priority = card.priority;
    if (card.expires_at != null) delivery.expires_at = card.expires_at;
    const repeat = normalizeRepeat(card.repeat);
    if (repeat) delivery.repeat = repeat;
    if (Object.keys(delivery).length) body.delivery = delivery;
    return body;
  }

  // Mirror the bus's lane slug rules so card paths match the stored lane id — otherwise a lane
  // name like "Spanish Vocab" (stored as "spanish-vocab") would never match its card path.
  laneId(lane) {
    return String(lane || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
  }

  // Push one item, creating the lane only if it's missing. We try the push FIRST so a delegated
  // token scoped to just `push:lane/<id>` works on an existing lane without needing create:lane,
  // and so we never re-send a fallback title that would silently rename an existing lane. Only a
  // genuine 404 (lane doesn't exist yet) triggers a create-then-retry, using the canonical id the
  // server returns.
  async _pushCard(lane, body, laneOpts) {
    // Push by owner-scoped SLUG — the server resolves it within the caller's own namespace
    // (`ownerId:slug`). Client and server slugify identically, so the create-then-retry below
    // lands on the same lane.
    const slug = this.laneId(lane);
    const path = `/v1/lanes/${encodeURIComponent(slug)}/cards`;
    try {
      return { data: (await this._req("POST", path, body)).data, laneId: slug };
    } catch (e) {
      if (e.status !== 404) throw e;
      await this.createLane({ lane, ...(laneOpts || {}) }); // create the missing lane, then retry
      return { data: (await this._req("POST", path, body)).data, laneId: slug };
    }
  }

  async pushCard(card = {}) {
    const { data, laneId } = await this._pushCard(card.lane || this.defaultLane, this.buildCardBody(card), card.laneOpts);
    return { id: data.id, deduped: !!data.deduped, lane: laneId };
  }

  // Push many cards to one lane in a single call, applying a shared delivery config (class /
  // repeat / cooldown / max) that each card may override. The lane is created lazily on the first
  // push if it doesn't exist; existing lanes are never re-created (no rename, no create scope).
  async pushDeck({ lane, cards = [], repeat, cooldown_s, max, class: klass, laneOpts } = {}) {
    const target = lane || this.defaultLane;
    if (!Array.isArray(cards) || cards.length === 0) throw new Error("push_deck needs a non-empty cards array");

    const shared = {};
    if (klass != null) shared.class = klass;
    if (repeat != null || cooldown_s != null || max != null) {
      shared.repeat = repeat || { mode: "recurring", cooldown_s, max };
    }

    const items = [];
    let laneId = this.laneId(target);
    for (const c of cards) {
      const merged = { ...shared, ...c }; // per-card fields win over the shared defaults
      const res = await this._pushCard(target, this.buildCardBody(merged), laneOpts);
      laneId = res.laneId;
      items.push({ id: res.data.id, deduped: !!res.data.deduped });
    }
    return { lane: laneId, count: items.length, items };
  }

  async getHistory(limit = 50) {
    const { data } = await this._req("GET", `/v1/feed/history?limit=${encodeURIComponent(limit)}`);
    return data.cards || [];
  }

  // Best-effort status so an agent can avoid overflooding a lane. /v1/me lands in T-12; until then
  // we return the health snapshot plus the lane list (with any per-lane counts the bus exposes).
  async getFeedStatus() {
    const health = (await this._req("GET", "/health")).data;
    let me = null;
    try { me = (await this._req("GET", "/v1/me")).data; } catch { /* /v1/me not built yet */ }
    let lanes = [];
    try { lanes = await this.listLanes(); } catch { /* unauth or offline */ }
    return { health, me, lanes };
  }
}

// Normalize a repeat spec into the bus's { mode, cooldown_s?, max? } shape. Accepts a string
// ("once" | "recurring") or an object; returns undefined when nothing was specified.
export function normalizeRepeat(r) {
  if (r == null) return undefined;
  if (typeof r === "string") return r === "recurring" ? { mode: "recurring" } : { mode: "once" };
  if (r.mode === "recurring") {
    const out = { mode: "recurring" };
    if (r.cooldown_s != null) out.cooldown_s = r.cooldown_s;
    if (r.max != null) out.max = r.max;
    return out;
  }
  return { mode: "once" };
}
