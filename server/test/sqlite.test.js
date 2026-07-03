// Pins T-11: the SQLite driver implements the load/save seam and survives a "restart" (a fresh
// driver instance opening the same file), including a 10k-item synthetic load.
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { SqliteDriver } from "../src/drivers/sqlite.js";

const tmpFiles = [];
function tmpDb() {
  const f = path.join(os.tmpdir(), `wa-sqlite-${process.pid}-${tmpFiles.length}.db`);
  tmpFiles.push(f);
  return f;
}
afterEach(() => {
  for (const f of tmpFiles.splice(0)) for (const ext of ["", "-wal", "-shm"]) { try { fs.unlinkSync(f + ext); } catch { /* ignore */ } }
});

test("empty database loads every collection as an empty map", () => {
  const d = new SqliteDriver(tmpDb());
  const state = d.load();
  d.close();
  for (const c of ["owners", "keys", "channels", "items", "itemsByChannel", "subs", "delivery", "history", "cursor"]) {
    assert.deepEqual(state[c], {});
  }
});

test("save then load round-trips the db shape across a fresh connection (restart)", () => {
  const file = tmpDb();
  const w = new SqliteDriver(file);
  w.save({
    owners: { o1: { id: "o1", label: "acct" } },
    channels: { c1: { id: "c1", title: "C1", ownerId: "o1" } },
    items: { i1: { id: "i1", channelId: "c1", title: "hi" } },
    itemsByChannel: { c1: ["i1"] },
    subs: { o1: { c1: { muted: false } } },
  });
  w.close();

  const r = new SqliteDriver(file); // simulate process restart: new connection, same file
  const state = r.load();
  r.close();
  assert.equal(state.owners.o1.label, "acct");
  assert.equal(state.channels.c1.title, "C1");
  assert.equal(state.items.i1.title, "hi");
  assert.deepEqual(state.itemsByChannel.c1, ["i1"]);
  assert.equal(state.subs.o1.c1.muted, false);
});

test("10k items survive a save/restart cycle", () => {
  const file = tmpDb();
  const items = {};
  const ids = [];
  for (let i = 0; i < 10000; i++) { const id = "itm_" + i; items[id] = { id, channelId: "c1", title: "card " + i }; ids.push(id); }

  const w = new SqliteDriver(file);
  w.save({ channels: { c1: { id: "c1", ownerId: "o1" } }, items, itemsByChannel: { c1: ids } });
  w.close();

  const r = new SqliteDriver(file);
  const state = r.load();
  r.close();
  assert.equal(Object.keys(state.items).length, 10000);
  assert.equal(state.items["itm_9999"].title, "card 9999");
  assert.equal(state.itemsByChannel.c1.length, 10000);
});
