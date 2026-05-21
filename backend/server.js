// backend/server.js (PostgreSQL)
const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();

// For now allow all (so Netlify can call it). Later you can restrict origin.
app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS";
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("Missing DATABASE_URL environment variable");
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  // Render Postgres commonly needs SSL
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );
  `);
}

app.get("/", (req, res) => res.send("VortexBoost API is running"));

// Register
app.post("/api/register", async (req, res) => {
  const { username, email, password } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email, password required" });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters" });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const created_at = Date.now();

    const q = `
      INSERT INTO users (username, email, password_hash, created_at)
      VALUES ($1, $2, $3, $4)
      RETURNING id, username, email;
    `;

    const result = await pool.query(q, [
      username.trim(),
      email.trim().toLowerCase(),
      password_hash,
      created_at,
    ]);

    const user = result.rows[0];
    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    // unique violation
    if (err.code === "23505") {
      return res.status(409).json({ error: "Username or email already exists" });
    }
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Login
app.post("/api/login", async (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier and password required" });
  }

  const id = identifier.trim().toLowerCase();

  try {
    const result = await pool.query(
      `SELECT * FROM users WHERE lower(username)=$1 OR lower(email)=$1 LIMIT 1`,
      [id]
    );

    const row = result.rows[0];
    if (!row) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(password, row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = { id: row.id, username: row.username, email: row.email };
    const token = signToken(user);
    return res.json({ token, user });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Server error" });
  }
});

// Verify token
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

const PORT = process.env.PORT || 3000;

initDb()
  .then(() => {
    app.listen(PORT, () => console.log(`API running on port ${PORT}`));
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });