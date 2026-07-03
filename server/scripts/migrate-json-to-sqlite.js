#!/usr/bin/env node
// Migrate a JSON state file into a SQLite database file (T-11).
//   node scripts/migrate-json-to-sqlite.js <state.json> <out.db>
// The JSON blob is already in db shape, so we just hand it to the SQLite driver's save().
import fs from "node:fs";
import { SqliteDriver } from "../src/drivers/sqlite.js";

const [, , jsonPath, dbPath] = process.argv;
if (!jsonPath || !dbPath) {
  console.error("usage: node scripts/migrate-json-to-sqlite.js <state.json> <out.db>");
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const driver = new SqliteDriver(dbPath);
driver.save(data);
driver.close();

const counts = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, Object.keys(v || {}).length]));
console.log(`migrated ${jsonPath} → ${dbPath}`);
console.log("rows per collection:", JSON.stringify(counts));
