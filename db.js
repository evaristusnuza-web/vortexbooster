/* ============================================================
   Tiny SQLite layer using Node's built-in node:sqlite module
   (Node >= 22.5 — no native compilation needed).
   Exposes the same promise-style helpers the rest of the code
   expects: run / get / all.
   ============================================================ */
const { DatabaseSync } = require("node:sqlite");
const path = require("path");

const db = new DatabaseSync(path.join(__dirname, "data.db"));

const run = (sql, params = []) => {
  const r = db.prepare(sql).run(...params);
  return { lastID: Number(r.lastInsertRowid), changes: Number(r.changes) };
};

const get = (sql, params = []) => {
  const row = db.prepare(sql).get(...params);
  return row || null;
};

const all = (sql, params = []) => db.prepare(sql).all(...params);

module.exports = { db, run, get, all };
