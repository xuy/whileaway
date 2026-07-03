// SQLite storage driver (hosted). Implements the same { load(): object, save(db): void } seam as
// JsonDriver, but each top-level collection becomes a table of (k TEXT PRIMARY KEY, v JSON TEXT),
// so items/channels/etc. are real rows rather than one giant blob. save() replaces all rows in a
// single transaction — cheap for v0 scale and debounced by store.save().
import Database from "better-sqlite3";
import path from "node:path";

// The db shape's top-level maps (see store.js). Each is persisted as its own table.
const COLLECTIONS = ["owners", "keys", "channels", "items", "itemsByChannel", "subs", "delivery", "history", "cursor"];

export class SqliteDriver {
  constructor(file = process.env.VIBEFEED_STATE || path.join(process.cwd(), ".vibefeed.db")) {
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    for (const c of COLLECTIONS) {
      this.db.exec(`CREATE TABLE IF NOT EXISTS "${c}" (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
    }
  }

  load() {
    const out = {};
    for (const c of COLLECTIONS) {
      const map = {};
      for (const row of this.db.prepare(`SELECT k, v FROM "${c}"`).all()) map[row.k] = JSON.parse(row.v);
      out[c] = map;
    }
    return out;
  }

  save(db) {
    const write = this.db.transaction(() => {
      for (const c of COLLECTIONS) {
        this.db.prepare(`DELETE FROM "${c}"`).run();
        const ins = this.db.prepare(`INSERT INTO "${c}" (k, v) VALUES (?, ?)`);
        const coll = db[c] || {};
        for (const k of Object.keys(coll)) ins.run(k, JSON.stringify(coll[k]));
      }
    });
    write();
  }

  close() { this.db.close(); }
}
