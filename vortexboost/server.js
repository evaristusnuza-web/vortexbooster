// backend/server.js
const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const app = express();

// For local dev allow all. On production, restrict to your frontend domain.
app.use(cors());
app.use(express.json());

const db = new sqlite3.Database("./data.db");

// On Render you MUST set JWT_SECRET in Environment Variables.
const JWT_SECRET = process.env.JWT_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET";

// Create users table if it doesn't exist
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`);

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

// Health check
app.get("/", (req, res) => res.send("VortexBoost API is running"));

// REGISTER: username, email, password
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

    db.run(
      `INSERT INTO users (username, email, password_hash, created_at)
       VALUES (?, ?, ?, ?)`,
      [username.trim(), email.trim().toLowerCase(), password_hash, created_at],
      function (err) {
        if (err) {
          if (err.message.includes("UNIQUE")) {
            return res.status(409).json({ error: "Username or email already exists" });
          }
          return res.status(500).json({ error: "Database error" });
        }

        const user = {
          id: this.lastID,
          username: username.trim(),
          email: email.trim().toLowerCase(),
        };

        const token = signToken(user);
        return res.json({ token, user });
      }
    );
  } catch {
    return res.status(500).json({ error: "Server error" });
  }
});

// LOGIN: identifier (email or username), password
app.post("/api/login", (req, res) => {
  const { identifier, password } = req.body || {};

  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier and password required" });
  }

  const id = identifier.trim().toLowerCase();

  db.get(
    `SELECT * FROM users WHERE lower(username)=? OR lower(email)=?`,
    [id, id],
    async (err, row) => {
      if (err) return res.status(500).json({ error: "Database error" });
      if (!row) return res.status(401).json({ error: "Invalid credentials" });

      const ok = await bcrypt.compare(password, row.password_hash);
      if (!ok) return res.status(401).json({ error: "Invalid credentials" });

      const user = { id: row.id, username: row.username, email: row.email };
      const token = signToken(user);
      return res.json({ token, user });
    }
  );
});

// ME: verify token
app.get("/api/me", auth, (req, res) => {
  res.json({ user: req.user });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`API running on http://localhost:${PORT}`));