/* ============================================================
   Schema + migrations.

   Kept separate from server.js so command-line scripts
   (scripts/create-user.js) can ensure the database exists without
   booting the HTTP server.

   Every statement here is written to work on BOTH SQLite and
   Postgres — `db.idColumn` supplies the dialect-specific primary key.
   ============================================================ */

const crypto = require("crypto");
const db = require("./db");

const genRefCode = () =>
  crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);

async function migrate() {
  const ID = db.idColumn; // "INTEGER PRIMARY KEY AUTOINCREMENT" | "SERIAL PRIMARY KEY"

  await db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id ${ID},
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    )
  `);

  // Columns added after the first release. Safe no-ops when present,
  // on both dialects (Postgres also supports ADD COLUMN IF NOT EXISTS,
  // but try/catch keeps one code path for both).
  const cols = [
    ["country", "TEXT NOT NULL DEFAULT 'Cameroon'"],
    ["email_verified", "INTEGER NOT NULL DEFAULT 1"],
    ["api_key", "TEXT"],
    ["referral_code", "TEXT"],
    ["referred_by", "INTEGER"],
  ];
  for (const [name, def] of cols) {
    try {
      await db.run(`ALTER TABLE users ADD COLUMN ${name} ${def}`);
    } catch {
      /* already exists */
    }
  }

  await db.run(`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY,
      balance BIGINT NOT NULL DEFAULT 0,
      affiliate_balance BIGINT NOT NULL DEFAULT 0
    )
  `);

  await db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id ${ID},
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,          -- deposit | order | refund | affiliate
      amount BIGINT NOT NULL,      -- signed, in XAF
      note TEXT,
      ref TEXT,
      created_at BIGINT NOT NULL
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id)`);

  await db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      id ${ID},
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      service TEXT NOT NULL,
      type TEXT NOT NULL,
      service_label TEXT NOT NULL,
      link TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price BIGINT NOT NULL,       -- charged to customer (your selling price)
      cost BIGINT NOT NULL,        -- what Simmwiz charges you
      status TEXT NOT NULL,        -- pending | completed | canceled
      provider_order_id TEXT,
      remains INTEGER,
      created_at BIGINT NOT NULL,
      updated_at BIGINT NOT NULL
    )
  `);
  await db.run(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id)`);

  await db.run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id ${ID},
      user_id INTEGER NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      campay_id TEXT,
      method TEXT NOT NULL,
      amount BIGINT NOT NULL,
      status TEXT NOT NULL,        -- created | success | failed
      created_at BIGINT NOT NULL,
      completed_at BIGINT
    )
  `);

  // Backfill: wallet + referral code for pre-existing users
  const users = await db.all(`SELECT id, referral_code FROM users`);
  for (const u of users) {
    await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [u.id]);
    if (!u.referral_code) {
      await db.run(`UPDATE users SET referral_code = ? WHERE id = ?`, [
        genRefCode(),
        u.id,
      ]);
    }
  }

  // Unique referral codes. A plain UNIQUE index is enough: both SQLite and
  // Postgres treat NULLs as distinct, so users without a code don't clash.
  await db.run(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_refcode ON users(referral_code)`
  );
}

module.exports = { migrate, genRefCode };
