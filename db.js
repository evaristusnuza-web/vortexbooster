/* ============================================================
   VortexBoost data layer — dual dialect.

   Chooses its backend automatically at startup:

     DATABASE_URL set    ->  PostgreSQL   (durable on any Render plan)
     DATABASE_URL unset  ->  SQLite       (zero config; local dev, or a
                                            Render persistent disk via DB_PATH)

   Both backends expose the SAME tiny promise-friendly API the rest of
   the app already uses:

       await run(sql, params)  ->  { lastID, changes }
       await get(sql, params)  ->  row | null
       await all(sql, params)  ->  [ rows ]

   Write queries with `?` placeholders and they work on both dialects —
   the Postgres side rewrites them to $1, $2, … automatically.

   ------------------------------------------------------------
   Postgres translation rules (applied only when DATABASE_URL is set)
   ------------------------------------------------------------
   1. `?` placeholders               -> $1, $2, …
   2. `INSERT OR IGNORE INTO t ...`  -> `INSERT INTO t ... ON CONFLICT DO NOTHING`
   3. `INSERT INTO <table with id>`  -> appends `RETURNING id` so the
      caller still gets `lastID`, matching SQLite's lastInsertRowid.
      (Skipped for `wallets`, whose primary key is user_id.)

   `dialect`, `idColumn` and `write()` are exported so schema.js can
   emit the correct DDL per backend.
   ============================================================ */

const path = require("path");
const fs = require("fs");

const DATABASE_URL = (process.env.DATABASE_URL || "").trim();
const isPostgres = Boolean(DATABASE_URL);

/* ---------------------------------------------------------------
   Placeholder + dialect translation
   --------------------------------------------------------------- */

// Tables whose primary key column is `id` (i.e. INSERT … RETURNING id is valid).
const TABLES_WITH_ID = new Set(["users", "transactions", "orders", "deposits"]);

function insertTargetTable(sql) {
  const m = /^\s*INSERT\s+(?:OR\s+IGNORE\s+)?INTO\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Rewrite a `?`-style query for Postgres.
 * Returns { sql, returning } where `returning` is true if we appended
 * RETURNING id (so the caller can read lastID back out).
 */
function toPostgres(sql) {
  let out = sql;

  // 1. INSERT OR IGNORE -> ON CONFLICT DO NOTHING
  out = out.replace(
    /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i,
    "INSERT INTO"
  );
  const wasInsertOrIgnore = /^\s*INSERT\s+OR\s+IGNORE\s+INTO/i.test(sql);

  // 2. ? -> $n  (only outside of string literals)
  let i = 0;
  out = out.replace(/'[^']*'|"[^"]*"|\?/g, (match) => {
    if (match === "?") {
      i += 1;
      return "$" + i;
    }
    return match;
  });

  // 3. Append ON CONFLICT for the OR IGNORE case
  if (wasInsertOrIgnore && !/ON\s+CONFLICT/i.test(out)) {
    out = out.replace(/;\s*$/, "") + " ON CONFLICT DO NOTHING";
  }

  // 4. Expose lastID on INSERTs into tables that have an `id` column
  let returning = false;
  const table = insertTargetTable(out);
  if (table && TABLES_WITH_ID.has(table) && !/RETURNING/i.test(out)) {
    out = out.replace(/;\s*$/, "") + " RETURNING id";
    returning = true;
  }

  return { sql: out, returning };
}

/* ---------------------------------------------------------------
   SQLite backend (node:sqlite — built in, no native compilation)
   --------------------------------------------------------------- */

// DB_PATH lets you point at a mounted Render persistent disk,
// e.g. DB_PATH=/var/data/data.db
const SQLITE_FILE = process.env.DB_PATH || path.join(__dirname, "data.db");

function createSqliteBackend() {
  const { DatabaseSync } = require("node:sqlite");

  const DB_FILE = SQLITE_FILE;

  // Make sure the parent directory exists (a fresh disk mount is empty).
  const dir = path.dirname(DB_FILE);
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  } catch {
    /* best effort — sqlite will surface a clear error if it truly can't open */
  }

  const db = new DatabaseSync(DB_FILE);

  // WAL keeps the pincher-polling writer from blocking readers.
  try {
    db.exec("PRAGMA journal_mode = WAL");
    db.exec("PRAGMA foreign_keys = ON");
  } catch {
    /* optional pragmas */
  }

  return {
    dialect: "sqlite",
    file: DB_FILE,
    async ping() {
      db.prepare("SELECT 1 AS ok").get();
      return true;
    },
    async query(sql, params = [], returning = false) {
      const trimmed = sql.trimStart().toUpperCase();
      const isWrite =
        trimmed.startsWith("INSERT") ||
        trimmed.startsWith("UPDATE") ||
        trimmed.startsWith("DELETE") ||
        trimmed.startsWith("CREATE") ||
        trimmed.startsWith("ALTER") ||
        trimmed.startsWith("DROP");

      const stmt = db.prepare(sql);
      if (isWrite) {
        const r = stmt.run(...params);
        return {
          rows: [],
          rowCount: Number(r.changes),
          lastID: Number(r.lastInsertRowid),
        };
      }
      const rows = stmt.all(...params);
      if (trimmed.startsWith("SELECT") && !trimmed.startsWith("SELECT 1")) {
        // keep rows first for get()/all()
      }
      return { rows, rowCount: rows.length, lastID: null };
    },
    async close() {
      try {
        db.close();
      } catch {
        /* already closed */
      }
    },
  };
}

/* ---------------------------------------------------------------
   Postgres backend
   --------------------------------------------------------------- */

// Overridable so the test suite can inject an in-process Postgres emulator.
let pgModuleFactory = () => require("pg");

function createPostgresBackend() {
  const pg = pgModuleFactory();
  const { Pool, types } = pg;

  // node-postgres returns BIGINT (int8) as a *string* to avoid precision
  // loss. Our timestamps (Date.now() ≈ 1.7e12) and COUNT/SUM results are
  // all safe integers, so parse them back to Number and keep the API
  // identical to the SQLite backend.
  if (types && typeof types.setTypeParser === "function") {
    types.setTypeParser(20, (v) => (v === null ? null : Number(v))); // int8
    types.setTypeParser(1700, (v) => (v === null ? null : Number(v))); // numeric
  }

  const needsSsl =
    /sslmode=require|ssl=true/i.test(DATABASE_URL) ||
    (process.env.PGSSL !== "disable" &&
      !/localhost|127\.0\.0\.1/i.test(DATABASE_URL));

  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: needsSsl ? { rejectUnauthorized: false } : false,
    max: Number(process.env.PG_POOL_MAX || 10),
  });

  pool.on("error", (err) => {
    console.error("[db] idle Postgres client error:", err.message);
  });

  return {
    dialect: "postgres",
    file: null,
    async ping() {
      await pool.query("SELECT 1");
      return true;
    },
    async query(sql, params = []) {
      const { sql: pgSql, returning } = toPostgres(sql);
      const res = await pool.query(pgSql, params);
      const rows = res.rows || [];
      return {
        rows,
        rowCount: typeof res.rowCount === "number" ? res.rowCount : rows.length,
        lastID: returning && rows[0] ? Number(rows[0].id) : null,
      };
    },
    async close() {
      await pool.end();
    },
  };
}

/* ---------------------------------------------------------------
   Public surface
   --------------------------------------------------------------- */

// Built on first use, not at require() time — so nothing tries to open a
// connection merely because a module imported this file, and tests can
// swap the pg factory beforehand.
let backend = null;
function getBackend() {
  if (!backend) {
    backend = isPostgres ? createPostgresBackend() : createSqliteBackend();
  }
  return backend;
}

async function run(sql, params = []) {
  const r = await getBackend().query(sql, params);
  return { lastID: r.lastID, changes: r.rowCount };
}

async function get(sql, params = []) {
  const r = await getBackend().query(sql, params);
  return r.rows.length ? r.rows[0] : null;
}

async function all(sql, params = []) {
  const r = await getBackend().query(sql, params);
  return r.rows;
}

/** Raw escape hatch (used by scripts and health checks). */
async function query(sql, params = []) {
  return getBackend().query(sql, params);
}

module.exports = {
  run,
  get,
  all,
  query,
  ping: () => getBackend().ping(),
  close: () => (backend ? backend.close() : Promise.resolve()),
  dialect: isPostgres ? "postgres" : "sqlite",
  isPostgres,
  /** Exposed so the test suite can assert the exact SQL we emit. */
  translateForPostgres: toPostgres,
  // DDL helper so schema.js can stay dialect-aware
  idColumn: isPostgres ? "SERIAL PRIMARY KEY" : "INTEGER PRIMARY KEY AUTOINCREMENT",
  /** Path of the SQLite file (null when running on Postgres). */
  file: isPostgres ? null : SQLITE_FILE,
  __setPgFactoryForTests(fn) {
    pgModuleFactory = fn;
  },
};
