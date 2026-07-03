// JSON-file storage driver — the self-host default. Reads/writes the whole db as one JSON blob.
// This is the exact persistence behavior the bus shipped with; T-02 just moves it behind the
// driver interface { load(): object, save(db): void } so T-11 can add a SQLite driver alongside.
import fs from "node:fs";
import path from "node:path";

export class JsonDriver {
  constructor(file = process.env.WHILEAWAY_STATE || path.join(process.cwd(), ".whileaway-state.json")) {
    this.file = file;
  }

  // Return the persisted snapshot, or {} on first run / unreadable file.
  load() {
    try { return JSON.parse(fs.readFileSync(this.file, "utf8")); }
    catch { return {}; }
  }

  save(db) {
    try { fs.writeFileSync(this.file, JSON.stringify(db)); }
    catch (e) { console.warn("[whileaway] persist failed:", e.message); }
  }
}
