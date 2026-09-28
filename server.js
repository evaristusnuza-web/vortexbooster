// ============================================================
//  VortexBoost API
//  Express + SQLite + JWT + bcrypt
//
//  Reseller flow:
//   1. Customer tops up their wallet via CAMPay (MTN MoMo /
//      Orange Money / Crypto).
//   2. Customer places an order -> wallet is debited at YOUR
//      selling price (catalog.json).
//   3. The same order is forwarded to Simmwiz (upstream) via
//      its SMM-panel API. Simmwiz charges YOUR Simmwiz balance
//      at the provider rate -> the difference is your margin.
//   4. A background poller tracks provider orders; completed
//      orders are marked completed, canceled orders refund the
//      customer automatically.
//
//  Environment variables (set on Render):
//   JWT_SECRET                long random string (REQUIRED in prod)
//   OWNER_EMAIL               your account email (sees margin stats)
//   SIMMWIZ_API_URL           e.g. https://www.simmwiz.com/api/v2
//   SIMMWIZ_API_KEY           your Simmwiz API key
//   CAMPAY_BASE_URL           https://api.campayapp.com/v2 (default)
//   CAMPAY_API_KEY            CAMPay X-Api-Key
//   CAMPAY_SECRET             CAMPay X-Secret-ApiKey
//   CAMPAY_MERCHANT_ACCOUNT   CAMPay merchant account uuid
//   ENABLE_TEST_DEPOSITS      "1" = instantly credit deposits (DEV ONLY)
// ============================================================

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const path = require("path");
const crypto = require("crypto");

// SQLite via Node's built-in node:sqlite (Node >= 22.5, zero native builds)
const { run, get, all } = require("./db");

const app = express();

// For local dev allow all. In production restrict to your frontend domain.
app.use(cors());
app.use(express.json({ limit: "2mb" }));

/* ============================ CONFIG ============================ */
const CONFIG = {
  JWT_SECRET: process.env.JWT_SECRET || "CHANGE_THIS_TO_A_LONG_RANDOM_SECRET",
  OWNER_EMAIL: (process.env.OWNER_EMAIL || "evaristusnuza@gmail.com").toLowerCase(),

  // --- Simmwiz (upstream provider you resell from) ---
  SIMMWIZ_API_URL: process.env.SIMMWIZ_API_URL || "",
  SIMMWIZ_API_KEY: process.env.SIMMWIZ_API_KEY || "",

  // --- CAMPay (MTN MoMo, Orange Money, Crypto) ---
  CAMPAY_BASE_URL: process.env.CAMPAY_BASE_URL || "https://api.campayapp.com/v2",
  CAMPAY_API_KEY: process.env.CAMPAY_API_KEY || "",
  CAMPAY_SECRET: process.env.CAMPAY_SECRET || "",
  CAMPAY_MERCHANT_ACCOUNT: process.env.CAMPAY_MERCHANT_ACCOUNT || "",

  // DEV ONLY: set "1" to credit deposits instantly without CAMPay.
  ENABLE_TEST_DEPOSITS: process.env.ENABLE_TEST_DEPOSITS === "1",

  REFERRAL_RATE: 0.05, // 5% of each referred user's deposit
  DEPOSIT_MIN: 100,
  DEPOSIT_MAX: 50000000,
  DEMO_ORDER_MS: Number(process.env.DEMO_ORDER_MS || 90000), // demo mode: fake provider completes after this
};

const simmwizConfigured = () => Boolean(CONFIG.SIMMWIZ_API_URL && CONFIG.SIMMWIZ_API_KEY);
const campayConfigured = () => Boolean(CONFIG.CAMPAY_API_KEY && CONFIG.CAMPAY_SECRET && CONFIG.CAMPAY_MERCHANT_ACCOUNT);

/* ============================ CATALOG ============================ */
const CATALOG_DATA = JSON.parse(require("fs").readFileSync(path.join(__dirname, "catalog.json"), "utf8"));

function getType(platform, service, type) {
  const t = CATALOG_DATA[platform]?.services?.[service]?.types?.[type];
  return t || null;
}

/* ============================ MIGRATION ============================ */
async function migrate() {
  await run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `);
  // Add columns introduced later (safe no-ops if already present)
  const cols = [
    ["country", "TEXT NOT NULL DEFAULT 'Cameroon'"],
    ["email_verified", "INTEGER NOT NULL DEFAULT 1"],
    ["api_key", "TEXT"],
    ["referral_code", "TEXT"],
    ["referred_by", "INTEGER"],
  ];
  for (const [name, def] of cols) {
    try { await run(`ALTER TABLE users ADD COLUMN ${name} ${def}`); } catch { /* exists */ }
  }

  await run(`
    CREATE TABLE IF NOT EXISTS wallets (
      user_id INTEGER PRIMARY KEY,
      balance INTEGER NOT NULL DEFAULT 0,
      affiliate_balance INTEGER NOT NULL DEFAULT 0
    )
  `);

  await run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      type TEXT NOT NULL,          -- deposit | order | refund | affiliate
      amount INTEGER NOT NULL,     -- signed, in XAF
      note TEXT,
      ref TEXT,
      created_at INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(user_id, id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      platform TEXT NOT NULL,
      service TEXT NOT NULL,
      type TEXT NOT NULL,
      service_label TEXT NOT NULL,
      link TEXT NOT NULL,
      qty INTEGER NOT NULL,
      price INTEGER NOT NULL,      -- charged to customer (your selling price)
      cost INTEGER NOT NULL,       -- what Simmwiz charges you
      status TEXT NOT NULL,        -- pending | completed | canceled
      provider_order_id TEXT,
      remains INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  await run(`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, id)`);

  await run(`
    CREATE TABLE IF NOT EXISTS deposits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      reference TEXT UNIQUE NOT NULL,
      campay_id TEXT,
      method TEXT NOT NULL,
      amount INTEGER NOT NULL,
      status TEXT NOT NULL,        -- created | success | failed
      created_at INTEGER NOT NULL,
      completed_at INTEGER
    )
  `);

  // Backfill: wallet + referral code for pre-existing users
  const users = await all(`SELECT id, referral_code FROM users`);
  for (const u of users) {
    await run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [u.id]);
    if (!u.referral_code) {
      await run(`UPDATE users SET referral_code = ? WHERE id = ?`, [genRefCode(), u.id]);
    }
  }
  // Unique index on referral codes (partial so NULLs are fine)
  await run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_users_refcode ON users(referral_code) WHERE referral_code IS NOT NULL`);
}

/* ============================ TOKENS ============================ */
function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, email: user.email },
    CONFIG.JWT_SECRET,
    { expiresIn: "7d" }
  );
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing token" });
  try {
    req.user = jwt.verify(token, CONFIG.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

// Load full user row (with country/referral etc.) for authed requests
async function loadUser(id) {
  const u = await get(`SELECT * FROM users WHERE id = ?`, [id]);
  if (!u) return null;
  u.isOwner = u.email.toLowerCase() === CONFIG.OWNER_EMAIL;
  return u;
}

const isOwnerOf = (u) => u.email.toLowerCase() === CONFIG.OWNER_EMAIL;
const genRefCode = () =>
  crypto.randomBytes(5).toString("hex").toUpperCase().slice(0, 8);
const randKey = () => crypto.randomBytes(24).toString("hex");

/* ============================ WALLET ============================ */
async function ensureWallet(userId) {
  await run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [userId]);
}

async function addTx(userId, type, amount, note = "", ref = "") {
  await run(
    `INSERT INTO transactions (user_id, type, amount, note, ref, created_at) VALUES (?,?,?,?,?,?)`,
    [userId, type, amount, note, ref, Date.now()]
  );
}

async function creditCustomer(user, amount, type, note, ref) {
  await ensureWallet(user.id);
  await run(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`, [amount, user.id]);
  await addTx(user.id, type, amount, note, ref);
}

// Idempotent deposit credit (guarded by deposits.status)
async function completeDeposit(dep, note) {
  const fresh = await get(`SELECT * FROM deposits WHERE id = ? AND status != 'success'`, [dep.id]);
  if (!fresh) return; // already credited
  await run(`UPDATE deposits SET status='success', completed_at=? WHERE id=?`, [Date.now(), dep.id]);
  await ensureWallet(dep.user_id);
  await run(`UPDATE wallets SET balance = balance + ? WHERE user_id = ?`, [dep.amount, dep.user_id]);
  await addTx(dep.user_id, "deposit", dep.amount, note, dep.reference);

  // Referral commission -> referrer's affiliate balance
  const referred = await get(`SELECT referred_by FROM users WHERE id = ?`, [dep.user_id]);
  if (referred && referred.referred_by) {
    const bonus = Math.floor(dep.amount * CONFIG.REFERRAL_RATE);
    if (bonus > 0) {
      await ensureWallet(referred.referred_by);
      await run(`UPDATE wallets SET affiliate_balance = affiliate_balance + ? WHERE user_id = ?`, [bonus, referred.referred_by]);
      await addTx(referred.referred_by, "affiliate", bonus, `Referral commission (${CONFIG.REFERRAL_RATE * 100}% of deposit)`, dep.reference);
    }
  }
}

/* ============================ SIMMWIZ CLIENT ============================ */
let simmwizRates = {}; // serviceId -> rate (per 1000)

async function simmwizCall(params) {
  if (!simmwizConfigured()) throw new Error("Simmwiz API is not configured");
  const res = await fetch(CONFIG.SIMMWIZ_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: CONFIG.SIMMWIZ_API_KEY, ...params }),
  });
  const data = await res.json().catch(() => ({ error: "Invalid Simmwiz response" }));
  if (data.error) throw Object.assign(new Error(data.error), { providerError: true });
  return data;
}

async function refreshSimmwizRates() {
  if (!simmwizConfigured()) return;
  try {
    const services = await simmwizCall({ action: "services" });
    simmwizRates = {};
    for (const s of services || []) simmwizRates[String(s.service)] = Number(s.rate) || 0;
    console.log(`[simmwiz] loaded ${Object.keys(simmwizRates).length} service rates`);
  } catch (e) {
    console.error("[simmwiz] rate refresh failed:", e.message);
  }
}

async function simmwizCost(typeData, qty) {
  const rate = typeData.simmwizService ? (simmwizRates[String(typeData.simmwizService)] || 0) : 0;
  const per1k = rate > 0 ? rate : (typeData.costPer1k || 0);
  return Math.max(1, Math.round((qty / 1000) * per1k));
}

/* ============================ CAMPAY CLIENT ============================ */
async function campayCall(method, urlPath, body) {
  if (!campayConfigured()) throw new Error("CAMPay is not configured");
  const res = await fetch(CONFIG.CAMPAY_BASE_URL + urlPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": CONFIG.CAMPAY_API_KEY,
      "X-Secret-ApiKey": CONFIG.CAMPAY_SECRET,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({ success: false, message: "Invalid CAMPay response" }));
  if (!data.success) throw new Error(data.message || "CAMPay error");
  return data.data;
}

/* ============================ ORDER ENGINE ============================ */
async function placeOrder(user, { platform, service, type, link, qty }) {
  const plat = CATALOG_DATA[platform];
  const svc = plat?.services?.[service];
  const typeData = svc?.types?.[type];
  if (!plat || !svc || !typeData) {
    const e = new Error("Unknown service"); e.status = 400; throw e;
  }
  if (!typeData.pricePer1k || typeData.pricePer1k <= 0) {
    const e = new Error("This service is not available yet."); e.status = 400; throw e;
  }

  const q = Number(qty);
  if (!Number.isFinite(q) || q < typeData.qty.min || q > typeData.qty.max) {
    const e = new Error(`Quantity must be between ${typeData.qty.min} and ${typeData.qty.max}.`);
    e.status = 400; throw e;
  }

  const price = Math.max(1, Math.round((q / 1000) * typeData.pricePer1k));

  await ensureWallet(user.id);
  const wallet = await get(`SELECT * FROM wallets WHERE user_id = ?`, [user.id]);
  if (wallet.balance < price) {
    const e = new Error(`Insufficient balance. You need ${price} XAF but have ${wallet.balance} XAF. Please add funds.`);
    e.status = 402; e.code = "INSUFFICIENT_BALANCE"; throw e;
  }

  const now = Date.now();

  // 1) Debit customer wallet (atomic guard)
  const upd = await run(
    `UPDATE wallets SET balance = balance - ? WHERE user_id = ? AND balance >= ?`,
    [price, user.id, price]
  );
  if (upd.changes === 0) {
    const e = new Error("Insufficient balance."); e.status = 402; e.code = "INSUFFICIENT_BALANCE"; throw e;
  }

  // 2) Forward to Simmwiz (or demo)
  let providerOrderId;
  let cost;
  if (simmwizConfigured() && typeData.simmwizService) {
    try {
      cost = await simmwizCost(typeData, q);
      const res = await simmwizCall({
        action: "add",
        service: typeData.simmwizService,
        link,
        quantity: q,
      });
      providerOrderId = String(res.order);
    } catch (err) {
      // Provider rejected -> refund the customer immediately
      await creditCustomer(user, price, "refund", "Order could not be placed with provider — refunded", "");
      await addTx(user.id, "order", -price, "Reversed: " + plat.label + " " + svc.label, "");
      const e = new Error("Provider rejected the order (" + err.message + "). You were not charged.");
      e.status = 502; throw e;
    }
  } else {
    // DEMO MODE: no Simmwiz key yet -> fake provider order, auto-completes in ~90s
    cost = await simmwizCost(typeData, q);
    providerOrderId = "demo-" + now.toString(36) + crypto.randomBytes(2).toString("hex");
  }

  // 3) Record transaction + order
  await addTx(user.id, "order", -price, `${svc.label} – ${plat.label}`, providerOrderId);
  const ins = await run(
    `INSERT INTO orders
       (user_id, platform, service, type, service_label, link, qty, price, cost, status, provider_order_id, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [user.id, platform, service, type, `${svc.label} - ${plat.label}`, link, q, price, cost, "pending", providerOrderId, now, now]
  );

  return await get(`SELECT * FROM orders WHERE id = ?`, [ins.lastID]);
}

async function markOrderCompleted(order, remains = null) {
  await run(
    `UPDATE orders SET status='completed', remains=?, updated_at=? WHERE id=? AND status='pending'`,
    [remains, Date.now(), order.id]
  );
}

async function markOrderCanceled(order) {
  await run(`UPDATE orders SET status='canceled', updated_at=? WHERE id=? AND status='pending'`, [Date.now(), order.id]);
  const user = await loadUser(order.user_id);
  if (user) await creditCustomer(user, order.price, "refund", "Canceled and Refunded", String(order.id));
}

// Background poller: track pending orders with the provider
setInterval(async () => {
  let pending;
  try { pending = await all(`SELECT * FROM orders WHERE status='pending' ORDER BY id LIMIT 25`); }
  catch { return; }
  for (const o of pending) {
    try {
      if (!simmwizConfigured()) {
        // Demo mode: fake provider completes after DEMO_ORDER_MS
        if (Date.now() - o.created_at > CONFIG.DEMO_ORDER_MS) await markOrderCompleted(o);
        continue;
      }
      if (!o.provider_order_id || o.provider_order_id.startsWith("demo-")) continue;
      const st = await simmwizCall({ action: "status", order: o.provider_order_id });
      const status = String(st.status || "").toLowerCase();
      if (status === "completed") {
        await markOrderCompleted(o, st.remains !== undefined ? Number(st.remains) : null);
      } else if (status === "canceled" || status === "cancelled") {
        await markOrderCanceled(o);
        console.log(`[orders] #${o.id} canceled by provider -> refunded`);
      } else if (status === "pending" && st.remains !== undefined) {
        await run(`UPDATE orders SET remains=?, updated_at=? WHERE id=?`, [Number(st.remains), Date.now(), o.id]);
      }
    } catch (e) {
      // Transient API errors: leave the order pending, retry next cycle
      if (!/no such order/i.test(e.message)) console.error(`[orders] status check failed for #${o.id}:`, e.message);
    }
  }
}, 30000);

/* ============================ ROUTES ============================ */
app.get("/api/health", (req, res) => res.send("VortexBoost API is running"));

// Expose catalog to the frontend (single source of truth)
app.get("/api/catalog", (req, res) => {
  const { _README, ...cat } = CATALOG_DATA;
  res.json(cat);
});

/* ---------- Auth ---------- */
app.post("/api/register", async (req, res) => {
  const { username, email, password, referral } = req.body || {};

  if (!username || !email || !password) {
    return res.status(400).json({ error: "username, email, password required" });
  }
  if (String(username).trim().length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) return res.status(400).json({ error: "Enter a valid email" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  try {
    const password_hash = await bcrypt.hash(String(password), 10);
    const created_at = Date.now();
    const uname = String(username).trim();
    const em = String(email).trim().toLowerCase();
    const refCode = genRefCode();

    // Optional referral
    let referredBy = null;
    if (referral) {
      const ref = await get(`SELECT id FROM users WHERE referral_code = ? AND id != ?`, [String(referral).trim().toUpperCase(), 0]);
      if (ref) referredBy = ref.id;
    }

    const info = await run(
      `INSERT INTO users (username, email, password_hash, created_at, referral_code, referred_by) VALUES (?,?,?,?,?,?)`,
      [uname, em, password_hash, created_at, refCode, referredBy]
    );
    await ensureWallet(info.lastID);

    const user = { id: info.lastID, username: uname, email: em };
    return res.json({ token: signToken(user), user, referralCode: refCode });
  } catch (err) {
    if (err.message && err.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Username or email already exists" });
    }
    return res.status(500).json({ error: "Server error" });
  }
});

app.post("/api/login", async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: "identifier and password required" });
  }
  const id = String(identifier).trim().toLowerCase();

  try {
    const row = await get(`SELECT * FROM users WHERE lower(username)=? OR lower(email)=?`, [id, id]);
    if (!row) return res.status(401).json({ error: "Invalid credentials" });

    const ok = await bcrypt.compare(String(password), row.password_hash);
    if (!ok) return res.status(401).json({ error: "Invalid credentials" });

    const user = { id: row.id, username: row.username, email: row.email };
    return res.json({ token: signToken(user), user });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/me", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  res.json({ user: { id: u.id, username: u.username, email: u.email, country: u.country, isOwner: u.isOwner, referralCode: u.referral_code } });
});

/* ---------- Account ---------- */
app.get("/api/account", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  res.json({
    username: u.username,
    email: u.email,
    emailVerified: Boolean(u.email_verified),
    country: u.country,
    isOwner: u.isOwner,
    referralCode: u.referral_code,
  });
});

app.patch("/api/account", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  const { username, country } = req.body || {};

  if (username !== undefined) {
    const uname = String(username).trim();
    if (uname.length < 3) return res.status(400).json({ error: "Username must be at least 3 characters" });
    await run(`UPDATE users SET username = ? WHERE id = ?`, [uname, u.id]);
  }
  if (country !== undefined) {
    const c = String(country).trim();
    if (!c) return res.status(400).json({ error: "Country required" });
    await run(`UPDATE users SET country = ? WHERE id = ?`, [c.slice(0, 60), u.id]);
  }
  const fresh = await loadUser(req.user.id);
  res.json({ username: fresh.username, country: fresh.country });
});

app.post("/api/account/password", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  const { current, password } = req.body || {};
  if (!current || !password) return res.status(400).json({ error: "Current password and new password required" });
  if (String(password).length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

  const ok = await bcrypt.compare(String(current), u.password_hash);
  if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

  const hash = await bcrypt.hash(String(password), 10);
  await run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, u.id]);
  res.json({ ok: true });
});

/* ---------- Wallet ---------- */
app.get("/api/wallet", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  await ensureWallet(u.id);

  const wallet = await get(`SELECT * FROM wallets WHERE user_id = ?`, [u.id]);
  const spent = await get(`SELECT COALESCE(SUM(-amount),0) AS s FROM transactions WHERE user_id=? AND type='order'`, [u.id]);
  const tx = await all(
    `SELECT id, type, amount, note, ref, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT 20`,
    [u.id]
  );
  const txCount = await get(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?`, [u.id]);

  res.json({
    balance: wallet.balance,
    affiliateBalance: wallet.affiliate_balance,
    totalSpent: spent.s,
    transactions: tx,
    txCount: txCount.c,
    isOwner: u.isOwner,
  });
});

app.get("/api/wallet/transactions", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const tx = await all(
    `SELECT id, type, amount, note, ref, created_at FROM transactions WHERE user_id = ? ORDER BY id DESC LIMIT ? OFFSET ?`,
    [u.id, limit, offset]
  );
  const total = await get(`SELECT COUNT(*) AS c FROM transactions WHERE user_id = ?`, [u.id]);
  res.json({ transactions: tx, total: total.c, hasMore: offset + tx.length < total.c });
});

// Start a CAMPay deposit
app.post("/api/wallet/deposit", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });

  const { method, amount, phone, coin, address } = req.body || {};
  const amt = Math.round(Number(amount));

  if (!["momo", "om", "crypto"].includes(method)) {
    return res.status(400).json({ error: "Choose a payment method (momo, om or crypto)" });
  }
  if (!Number.isFinite(amt) || amt < CONFIG.DEPOSIT_MIN || amt > CONFIG.DEPOSIT_MAX) {
    return res.status(400).json({ error: `Amount must be between ${CONFIG.DEPOSIT_MIN} and ${CONFIG.DEPOSIT_MAX} XAF` });
  }
  if (method !== "crypto") {
    const p = String(phone || "").replace(/[\s-]/g, "");
    if (!/^\d{8,13}$/.test(p)) return res.status(400).json({ error: "Enter a valid phone number" });
  } else if (!coin || !address) {
    return res.status(400).json({ error: "Coin and wallet address are required" });
  }
  if (!CONFIG.ENABLE_TEST_DEPOSITS && !campayConfigured()) {
    return res.status(503).json({ error: "Payments are being configured. Please try again a bit later." });
  }

  const reference = "VOX" + Date.now().toString(36).toUpperCase() + crypto.randomBytes(2).toString("hex").toUpperCase();
  const now = Date.now();

  // DEV/TEST MODE: credit instantly
  if (CONFIG.ENABLE_TEST_DEPOSITS) {
    const dep = await run(
      `INSERT INTO deposits (user_id, reference, campay_id, method, amount, status, created_at) VALUES (?,?,?,?,?,?,?)`,
      [u.id, reference, "test", method, amt, "created", now]
    );
    await completeDeposit({ id: dep.lastID, user_id: u.id, amount: amt, reference }, `Test deposit (dev mode)`);
    return res.json({ reference, status: "SUCCESS", test: true });
  }

  // REAL CAMPay flow
  // NOTE: field names follow CAMPay v2 docs (api.campayapp.com). Adjust
  // `network`/`coin` values to match the exact options in your CAMPay
  // merchant dashboard if they differ.
  let data;
  try {
    data = await campayCall("POST", "/transaction/", {
      merchant_account: CONFIG.CAMPAY_MERCHANT_ACCOUNT,
      customer: {
        name: u.username,
        email: u.email,
        phone: method !== "crypto" ? { country_code: "CM", number: String(phone).replace(/[\s-]/g, "") } : undefined,
        address: method === "crypto" ? String(address) : undefined,
        coin: method === "crypto" ? String(coin) : undefined,
      },
      amount: amt,
      currency: "XAF",
      network: method === "crypto" ? "crypto" : method, // "momo" | "om"
      reference,
    });
  } catch (e) {
    return res.status(502).json({ error: "Could not start payment: " + e.message });
  }

  const ins = await run(
    `INSERT INTO deposits (user_id, reference, campay_id, method, amount, status, created_at) VALUES (?,?,?,?,?,?,?)`,
    [u.id, reference, String(data.id), method, amt, "created", now]
  );

  res.json({
    reference,
    status: "CREATED",
    redirectUrl: data.redirect_url || null, // open to let the customer approve on their phone
  });
});

// Verify a deposit (frontend polls this; also confirms via CAMPay)
app.get("/api/wallet/deposit/:reference", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });

  const dep = await get(`SELECT * FROM deposits WHERE reference = ? AND user_id = ?`, [String(req.params.reference).toUpperCase(), u.id]);
  if (!dep) return res.status(404).json({ error: "Deposit not found" });

  if (dep.status === "success") return res.json({ reference: dep.reference, status: "SUCCESS", credited: true });

  if (CONFIG.ENABLE_TEST_DEPOSITS) return res.json({ reference: dep.reference, status: "SUCCESS", credited: true });

  try {
    const data = await campayCall("GET", `/transaction/${dep.campay_id}`);
    const st = String(data.status || "").toUpperCase();
    if (st === "SUCCESS") {
      await completeDeposit(dep, "Payment received");
      return res.json({ reference: dep.reference, status: "SUCCESS", credited: true });
    }
    if (st === "FAILED" || st === "CANCELLED") {
      await run(`UPDATE deposits SET status='failed' WHERE id=?`, [dep.id]);
      return res.json({ reference: dep.reference, status: "FAILED", credited: false });
    }
    return res.json({ reference: dep.reference, status: st || "PENDING", credited: false });
  } catch (e) {
    return res.status(502).json({ error: "Could not verify payment: " + e.message });
  }
});

// CAMPay webhook — re-verifies on CAMPay's side (never trust the payload alone)
app.post("/api/campay/webhook", async (req, res) => {
  try {
    const id = req.body?.id || req.body?.data?.id || req.body?.reference;
    if (id) {
      const dep = String(id).startsWith("VOX")
        ? await get(`SELECT * FROM deposits WHERE reference = ? AND status != 'success'`, [String(id).toUpperCase()])
        : await get(`SELECT * FROM deposits WHERE campay_id = ? AND status != 'success'`, [String(id)]);
      if (dep) {
        const data = await campayCall("GET", `/transaction/${dep.campay_id}`);
        const st = String(data.status || "").toUpperCase();
        if (st === "SUCCESS") await completeDeposit(dep, "Payment received");
        else if (st === "FAILED" || st === "CANCELLED") await run(`UPDATE deposits SET status='failed' WHERE id=?`, [dep.id]);
      }
    }
  } catch (e) {
    console.error("[campay] webhook error:", e.message);
  }
  res.sendStatus(200);
});

/* ---------- Orders ---------- */
app.post("/api/orders", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  const { platform, service, type, link, qty } = req.body || {};

  const l = String(link || "").trim();
  if (!/^https?:\/\/.+\..+/i.test(l)) {
    return res.status(400).json({ error: "Enter a valid link (must start with http:// or https://)" });
  }

  try {
    const order = await placeOrder(u, { platform, service, type, link: l, qty });
    res.json({ order });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/orders", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });

  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const status = String(req.query.status || "").toLowerCase();
  const q = String(req.query.q || "").trim();

  const where = ["user_id = ?"];
  const params = [u.id];
  if (["pending", "completed", "canceled"].includes(status)) { where.push("status = ?"); params.push(status); }
  if (q) { where.push("(CAST(id AS TEXT) LIKE ? OR service_label LIKE ?)"); params.push(`%${q}%`, `%${q}%`); }
  const whereSql = where.join(" AND ");

  const orders = await all(
    `SELECT * FROM orders WHERE ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const total = await get(`SELECT COUNT(*) AS c FROM orders WHERE ${whereSql}`, params);
  res.json({ orders, total: total.c, hasMore: offset + orders.length < total.c });
});

app.get("/api/orders/:id", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  const order = await get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [Number(req.params.id), u.id]);
  if (!order) return res.status(404).json({ error: "Order not found" });
  res.json({ order });
});

/* ---------- Referral ---------- */
app.get("/api/referral", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });

  await ensureWallet(u.id);
  const wallet = await get(`SELECT * FROM wallets WHERE user_id = ?`, [u.id]);
  const referred = await get(`SELECT COUNT(*) AS c FROM users WHERE referred_by = ?`, [u.id]);
  const recent = await all(
    `SELECT id, type, amount, note, created_at FROM transactions WHERE user_id = ? AND type = 'affiliate' ORDER BY id DESC LIMIT 10`,
    [u.id]
  );

  const baseUrl = req.headers.origin || req.headers.referer || "";
  const origin = baseUrl ? new URL(baseUrl).origin : "";

  res.json({
    code: u.referral_code,
    link: `${origin}/register.html?ref=${u.referral_code}`,
    rate: CONFIG.REFERRAL_RATE * 100,
    earnings: wallet.affiliate_balance,
    referredCount: referred.c,
    recent,
  });
});

/* ---------- Owner summary (your margin) ---------- */
app.get("/api/owner/summary", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  if (!isOwnerOf(u)) return res.status(403).json({ error: "Not allowed" });

  const deposits = await get(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='deposit' AND amount > 0`);
  const spend = await get(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='order' AND amount < 0`);
  const refunds = await get(`SELECT COALESCE(SUM(amount),0) AS s FROM transactions WHERE type='refund' AND amount > 0`);
  const o = await get(`SELECT COUNT(*) AS orders, COALESCE(SUM(price),0) AS revenue, COALESCE(SUM(cost),0) AS cost FROM orders`);
  const users = await get(`SELECT COUNT(*) AS c FROM users`);

  res.json({
    totalDeposits: deposits.s,
    totalOrderValue: o.revenue,
    providerCost: o.cost,
    netMargin: o.revenue - o.cost, // the money left in YOUR pocket
    totalRefunds: refunds.s,
    orders: o.orders,
    users: users.c,
  });
});

/* ---------- Public API (customer-facing, "API" menu page) ---------- */
async function publicAuth(req, res, next) {
  const key = req.headers["x-api-key"] || req.query.key;
  if (!key) return res.status(401).json({ error: "Missing API key (X-Api-Key header)" });
  const row = await get(`SELECT * FROM users WHERE api_key = ?`, [String(key)]);
  if (!row) return res.status(401).json({ error: "Invalid API key" });
  req.user = { id: row.id, username: row.username, email: row.email };
  next();
}

// GET returns the existing key; POST generates (or reuses) one; DELETE revokes
app.get("/api/public/key", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  res.json({ apiKey: u.api_key || null });
});

app.post("/api/public/key", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  let key = u.api_key;
  if (!key || (req.body || {}).force === true) {
    key = randKey();
    await run(`UPDATE users SET api_key = ? WHERE id = ?`, [key, u.id]);
  }
  res.json({ apiKey: key });
});

app.delete("/api/public/key", auth, async (req, res) => {
  const u = await loadUser(req.user.id);
  if (!u) return res.status(401).json({ error: "Invalid token" });
  await run(`UPDATE users SET api_key = NULL WHERE id = ?`, [u.id]);
  res.json({ ok: true });
});

// Parse "platform.service.type" -> parts
function parsePublicKey(key) {
  const [platform, service, type] = String(key).split(".");
  return { platform, service, type, typeData: getType(platform, service, type) };
}

app.get("/api/public/services", publicAuth, (req, res) => {
  const list = [];
  for (const [pKey, p] of Object.entries(CATALOG_DATA)) {
    if (pKey.startsWith("_")) continue;
    for (const [sKey, s] of Object.entries(p.services || {})) {
      for (const [tKey, t] of Object.entries(s.types || {})) {
        if (!t.pricePer1k || t.pricePer1k <= 0) continue;
        list.push({
          service: `${pKey}.${sKey}.${tKey}`,
          name: `${s.label} - ${p.label} (${t.label})`,
          rate: t.pricePer1k, // per 1000
          min: t.qty.min,
          max: t.qty.max,
        });
      }
    }
  }
  res.json(list);
});

app.get("/api/public/balance", publicAuth, async (req, res) => {
  await ensureWallet(req.user.id);
  const w = await get(`SELECT * FROM wallets WHERE user_id = ?`, [req.user.id]);
  res.json({ balance: w.balance });
});

app.post("/api/public/add", publicAuth, async (req, res) => {
  const { service, link, quantity } = req.body || {};
  const parsed = parsePublicKey(service);
  if (!parsed.typeData) return res.status(400).json({ error: "Unknown service key (format: platform.service.type)" });
  const u = await loadUser(req.user.id);
  try {
    const order = await placeOrder(u, {
      platform: parsed.platform,
      service: parsed.service,
      type: parsed.type,
      link: String(link || "").trim(),
      qty: quantity,
    });
    res.json({ order: order.id });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get("/api/public/status", publicAuth, async (req, res) => {
  const order = await get(`SELECT * FROM orders WHERE id = ? AND user_id = ?`, [Number(req.query.order), req.user.id]);
  if (!order) return res.status(404).json({ error: "No such order" });
  res.json({
    order: order.id,
    status: order.status,
    charge: order.price,
    charge_amount: order.price,
    remains: order.remains,
    average_time: CATALOG_DATA[order.platform]?.services?.[order.service]?.types?.[order.type]?.time || "",
    start_time: new Date(order.created_at).toISOString(),
  });
});

/* ---------- Static site (serves the frontend so everything works on one port) ---------- */
app.use("/src", express.static(path.join(__dirname, "src")));
app.use("/Public", express.static(path.join(__dirname, "Public")));

const SITE_PAGES = [
  "index.html", "login.html", "register.html", "home.html", "wallet.html",
  "payment.html", "orders.html", "account.html", "referral.html",
  "terms.html", "support.html", "api.html",
];
for (const f of SITE_PAGES) {
  app.get("/" + f, (req, res) => res.sendFile(path.join(__dirname, f)));
}
app.get("/", (req, res) => res.sendFile(path.join(__dirname, "index.html")));

/* ---------- Boot ---------- */
const PORT = process.env.PORT || 3000;
migrate()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`VortexBoost running on http://localhost:${PORT}`);
      console.log(simmwizConfigured() ? "[simmwiz] LIVE mode" : "[simmwiz] DEMO mode (set SIMMWIZ_API_URL + SIMMWIZ_API_KEY to go live)");
      console.log(campayConfigured() ? "[campay] LIVE mode" : CONFIG.ENABLE_TEST_DEPOSITS ? "[campay] TEST deposits enabled (instant credit)" : "[campay] NOT configured (set CAMPAY_API_KEY, CAMPAY_SECRET, CAMPAY_MERCHANT_ACCOUNT)");
      if (simmwizConfigured()) refreshSimmwizRates();
    });
  })
  .catch((e) => {
    console.error("DB init failed:", e);
    process.exit(1);
  });
