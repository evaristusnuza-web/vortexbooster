/* ============================================================
   SQLite backend tests — run against a REAL database (a throwaway
   file in the OS temp dir), so these are fully trustworthy.

   This is the backend used for local development and for a Render
   persistent-disk deployment, and it is the one that must survive
   being re-migrated on every single process start.
   ============================================================ */

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Must be set before db.js is required — it picks its backend at import time.
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vortex-sqlite-test-"));
process.env.DB_PATH = path.join(TMP_DIR, "test.db");
delete process.env.DATABASE_URL;

const db = require("../db");
const { migrate, genRefCode } = require("../schema");

test("uses the sqlite dialect and honours DB_PATH", () => {
  assert.equal(db.dialect, "sqlite");
  assert.equal(db.isPostgres, false);
  assert.equal(db.file, process.env.DB_PATH);
  assert.equal(db.idColumn, "INTEGER PRIMARY KEY AUTOINCREMENT");
});

test("migrate() creates every table", async () => {
  await migrate();

  const rows = await db.all(
    `SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`
  );
  const names = rows.map((r) => r.name);
  for (const expected of ["users", "wallets", "transactions", "orders", "deposits"]) {
    assert.ok(names.includes(expected), `missing table: ${expected}`);
  }
});

test("migrate() is idempotent — safe on every boot", async () => {
  // Render restarts the service often; migrations run against an existing
  // database each time and must never throw.
  await migrate();
  await migrate();
  const row = await db.get(`SELECT COUNT(*) AS c FROM users`);
  assert.equal(typeof row.c, "number");
});

test("migrate() does not disturb existing data on a re-run", async () => {
  await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["keeper", "keeper@example.com", "hash", Date.now()]
  );
  await migrate();
  const row = await db.get(`SELECT username FROM users WHERE email = ?`, [
    "keeper@example.com",
  ]);
  assert.equal(row.username, "keeper");
});

test("INSERT returns lastID and changes, like the old API promised", async () => {
  const info = await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["alice", "alice@example.com", "hash", Date.now()]
  );
  assert.equal(typeof info.lastID, "number");
  assert.ok(info.lastID > 0);
  assert.equal(info.changes, 1);
});

test("INSERT OR IGNORE is a safe no-op for duplicate wallets", async () => {
  await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [1]);
  await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [1]);

  const rows = await db.all(`SELECT * FROM wallets WHERE user_id = ?`, [1]);
  assert.equal(rows.length, 1);
});

test("timestamps round-trip as exact numbers (no float drift)", async () => {
  const now = Date.now();
  await db.run(
    `INSERT INTO transactions (user_id, type, amount, note, ref, created_at) VALUES (?,?,?,?,?,?)`,
    [1, "deposit", 5000, "test", "ref-1", now]
  );
  const tx = await db.get(`SELECT * FROM transactions WHERE ref = ?`, ["ref-1"]);
  assert.equal(tx.created_at, now);
  assert.equal(tx.amount, 5000);
});

test("a UNIQUE index still allows many NULL referral codes", async () => {
  // This is what lets every legacy user share `NULL` until backfilled.
  await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["n1", "n1@example.com", "h", Date.now()]
  );
  await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["n2", "n2@example.com", "h", Date.now()]
  );

  const nulls = await db.get(
    `SELECT COUNT(*) AS c FROM users WHERE referral_code IS NULL`
  );
  assert.ok(nulls.c >= 2, "multiple NULL referral codes must coexist");
});

test("duplicate referral codes are rejected", async () => {
  await db.run(`UPDATE users SET referral_code = ? WHERE username = ?`, [
    "DUPE1234",
    "n1",
  ]);
  await assert.rejects(
    async () =>
      await db.run(`UPDATE users SET referral_code = ? WHERE username = ?`, [
        "DUPE1234",
        "n2",
      ]),
    "a second user claiming the same code must fail"
  );
});

test("migrate() backfills a wallet + referral code for legacy users", async () => {
  // Simulate a pre-existing user row (as if from an older schema version)
  const info = await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["legacy", "legacy@example.com", "h", Date.now()]
  );

  await migrate();

  const user = await db.get(`SELECT referral_code FROM users WHERE id = ?`, [
    info.lastID,
  ]);
  assert.ok(user.referral_code, "legacy user should get a referral code");

  const wallet = await db.get(`SELECT * FROM wallets WHERE user_id = ?`, [
    info.lastID,
  ]);
  assert.ok(wallet, "legacy user should get a wallet");
  assert.equal(wallet.balance, 0);
});

test("genRefCode() produces 8 uppercase hex characters", () => {
  for (let i = 0; i < 50; i += 1) {
    const code = genRefCode();
    assert.match(code, /^[0-9A-F]{8}$/);
  }
});

test("the atomic wallet debit guard refuses to overspend", async () => {
  // This is the query placeOrder relies on to never go negative.
  await db.run(`UPDATE wallets SET balance = ? WHERE user_id = ?`, [1000, 1]);

  const ok = await db.run(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`,
    [600, 1, 600]
  );
  assert.equal(ok.changes, 1);

  const rejected = await db.run(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`,
    [600, 1, 600]
  );
  assert.equal(rejected.changes, 0, "second debit must be refused");

  const w = await db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [1]);
  assert.equal(w.balance, 400);
});

test("ping() reports the database is reachable", async () => {
  assert.equal(await db.ping(), true);
});

test.after(async () => {
  await db.close();
  fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
