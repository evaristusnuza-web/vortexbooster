/* ============================================================
   Postgres backend tests, run against pg-mem — an in-process
   Postgres emulator (no server needed).

   SCOPE / LIMITS — worth being explicit about:
   pg-mem is not Postgres. These tests prove the SQL we EMIT is
   Postgres-shaped (SERIAL, $n placeholders, ON CONFLICT,
   RETURNING id, int8 parsing) and that our `?`-to-`$n` rewriting
   is correct. They do NOT prove the connection layer works
   against a real server — that is confirmed by deploying.

   One emulator limitation is deliberately not asserted: pg-mem
   throws when `CREATE TABLE IF NOT EXISTS` is run twice, which is
   a pg-mem strictness quirk. Real Postgres treats a repeat as a
   no-op. Idempotent re-migration is covered properly against real
   SQLite in sqlite.test.js.
   ============================================================ */

const test = require("node:test");
const assert = require("node:assert/strict");
const { newDb } = require("pg-mem");

// db.js reads these at require() time — set them first.
process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/vortexbooster";
process.env.PGSSL = "disable";
delete process.env.DB_PATH;

const db = require("../db");

const mem = newDb();
const adapter = mem.adapters.createPg();
db.__setPgFactoryForTests(() => adapter);

const { migrate, genRefCode } = require("../schema");

test("DATABASE_URL switches the app to the postgres dialect", () => {
  assert.equal(db.dialect, "postgres");
  assert.equal(db.isPostgres, true);
  assert.equal(db.idColumn, "SERIAL PRIMARY KEY");
  assert.equal(db.file, null, "there is no sqlite file on postgres");
});

test("migrate() emits postgres-valid DDL for every table", async () => {
  await migrate();

  const rows = await db.all(
    `SELECT table_name AS name FROM information_schema.tables WHERE table_schema = ?`,
    ["public"]
  );
  const names = rows.map((r) => r.name);
  for (const expected of ["users", "wallets", "transactions", "orders", "deposits"]) {
    assert.ok(names.includes(expected), `missing table: ${expected}`);
  }
});

test("INSERT returns a numeric lastID via RETURNING id", async () => {
  const info = await db.run(
    `INSERT INTO users (username, email, password_hash, created_at) VALUES (?,?,?,?)`,
    ["alice", "alice@example.com", "hash", Date.now()]
  );
  assert.equal(typeof info.lastID, "number");
  assert.equal(info.lastID, 1);
  assert.equal(info.changes, 1);
});

test("INSERT OR IGNORE maps to ON CONFLICT DO NOTHING", async () => {
  await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [1]);
  await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [1]);
  const rows = await db.all(`SELECT * FROM wallets WHERE user_id = ?`, [1]);
  assert.equal(rows.length, 1);
});

test("inserting into wallets (no id column) does not break lastID", async () => {
  const info = await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [2]);
  assert.equal(info.lastID, null, "no RETURNING should be attempted for wallets");
});

test("BIGINT timestamps come back as numbers, not strings", async () => {
  const now = Date.now();
  await db.run(
    `INSERT INTO transactions (user_id, type, amount, note, ref, created_at) VALUES (?,?,?,?,?,?)`,
    [1, "deposit", 5000, "test", "ref-1", now]
  );

  const tx = await db.get(`SELECT * FROM transactions WHERE ref = ?`, ["ref-1"]);
  assert.equal(
    typeof tx.created_at,
    "number",
    "node-postgres returns int8 as a string unless we set a type parser"
  );
  assert.equal(tx.created_at, now);
  assert.equal(tx.amount, 5000);
});

test("COUNT() and SUM() are coerced to numbers too", async () => {
  const count = await db.get(`SELECT COUNT(*) AS c FROM transactions`);
  assert.equal(typeof count.c, "number");
  assert.equal(count.c, 1);

  const sum = await db.get(
    `SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE amount > 0`
  );
  assert.equal(typeof sum.s, "number");
  assert.equal(sum.s, 5000);
});

test("multiple ? placeholders rewrite to $1..$n in order", async () => {
  await db.run(
    `INSERT INTO orders
       (user_id, platform, service, type, service_label, link, qty, price, cost, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [1, "tiktok", "followers", "avg", "Followers - TikTok", "https://x.com/a",
     500, 1600, 700, "pending", Date.now(), Date.now()]
  );

  const order = await db.get(
    `SELECT * FROM orders WHERE user_id = ? AND status = ? AND id = ?`,
    [1, "pending", 1]
  );
  assert.ok(order, "all three placeholders should bind correctly");
  assert.equal(order.qty, 500);
  assert.equal(order.price, 1600);
  assert.equal(order.cost, 700);
  assert.equal(order.service_label, "Followers - TikTok");
});

test("a literal ? inside a string literal is left alone", async () => {
  await db.run(
    `INSERT INTO transactions (user_id, type, amount, note, created_at) VALUES (?,?,?,?,?)`,
    [1, "order", -100, "is this ok? yes", Date.now()]
  );
  const row = await db.get(`SELECT note FROM transactions WHERE note LIKE ?`, [
    "%ok? yes%",
  ]);
  assert.ok(row);
  assert.equal(row.note, "is this ok? yes");
});

test("UNIQUE constraint violations surface as rejections", async () => {
  await db.run(`UPDATE users SET referral_code = ? WHERE id = ?`, [genRefCode(), 1]);
  const code = (await db.get(`SELECT referral_code FROM users WHERE id = ?`, [1]))
    .referral_code;

  await assert.rejects(
    async () =>
      await db.run(
        `INSERT INTO users (username, email, password_hash, created_at, referral_code) VALUES (?,?,?,?,?)`,
        ["bob", "bob@example.com", "hash", Date.now(), code]
      ),
    "duplicate username/referral_code must be rejected"
  );
});

test("the order-search query (CAST + LIKE) works", async () => {
  const rows = await db.all(
    `SELECT * FROM orders WHERE (CAST(id AS TEXT) LIKE ? OR service_label LIKE ?)`,
    ["%1%", "%1%"]
  );
  assert.ok(rows.length >= 1);
});

test("the atomic wallet debit guard emits the right SQL and row counts", async () => {
  // NOTE: pg-mem mis-evaluates `balance - $1` (it computes 1000 - 600 as
  // -400, while the literal `balance - 600` works). That is an emulator
  // defect, not ours — the SQL below is textbook Postgres. So here we
  // assert the translated SQL text and the WHERE-guard row counts, both of
  // which pg-mem gets right, and leave the arithmetic proof to the real
  // SQLite test in sqlite.test.js.
  const { sql } = db.translateForPostgres(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`
  );
  assert.equal(
    sql,
    `UPDATE wallets SET balance = balance - $1 WHERE user_id = $2 AND balance >= $3`
  );

  await db.run(`UPDATE wallets SET balance = ? WHERE user_id = ?`, [1000, 1]);

  const ok = await db.run(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`,
    [600, 1, 600]
  );
  assert.equal(ok.changes, 1, "an affordable debit should match one row");

  // The guard is what stops an account going negative — it must match
  // nothing once the balance is too low.
  const rejected = await db.run(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`,
    [99999, 1, 99999]
  );
  assert.equal(rejected.changes, 0, "an unaffordable debit must match no rows");
});

test("the placeholder rewriter is exact (regression guard)", () => {
  const cases = [
    // [input, expected SQL, expecting RETURNING id?]
    [
      `SELECT * FROM users WHERE id = ?`,
      `SELECT * FROM users WHERE id = $1`,
      false,
    ],
    [
      `INSERT INTO users (username) VALUES (?)`,
      `INSERT INTO users (username) VALUES ($1) RETURNING id`,
      true,
    ],
    [
      `INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`,
      `INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT DO NOTHING`,
      false,
    ],
    [
      `UPDATE users SET username = ? WHERE id = ?`,
      `UPDATE users SET username = $1 WHERE id = $2`,
      false,
    ],
  ];

  for (const [input, expectedSql, expectedReturning] of cases) {
    const { sql, returning } = db.translateForPostgres(input);
    assert.equal(sql, expectedSql, `bad translation for: ${input}`);
    assert.equal(returning, expectedReturning);
  }

  // A pre-existing RETURNING must not be duplicated.
  const withReturning = db.translateForPostgres(
    `INSERT INTO orders (user_id) VALUES (?) RETURNING id`
  );
  assert.equal(
    withReturning.sql,
    `INSERT INTO orders (user_id) VALUES ($1) RETURNING id`
  );
  assert.equal(withReturning.returning, false);
});

test("wallets gets no RETURNING id, because it has no id column", () => {
  const { returning } = db.translateForPostgres(
    `INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`
  );
  assert.equal(returning, false);
});

test("ping() reaches the database", async () => {
  assert.equal(await db.ping(), true);
});

test("close() can be called when the backend was never used", async () => {
  // Defensive: the shutdown path calls this unconditionally.
  assert.doesNotThrow(() => {
    db.close();
  });
});
