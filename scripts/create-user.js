#!/usr/bin/env node
/* ============================================================
   Create (or update) a user from the command line — handy for
   getting a working login without going through the signup page,
   and for resetting a forgotten password.

   Usage:
     npm run create-user -- --username trojan --email you@example.com --password secret123
     npm run create-user -- --email you@example.com --password newpass --balance 50000

   Options:
     --username <name>   defaults to the part of the email before "@"
     --email <email>     required
     --password <pass>   required (min 6 chars)
     --country <name>    defaults to Cameroon
     --balance <n>       set the wallet balance (XAF) and log a transaction
     --owner             print the OWNER_EMAIL line to put in .env

   Existing user? The password is reset and any other flags are applied.
   ============================================================ */

require("dotenv").config({ quiet: true });

const bcrypt = require("bcrypt");
const db = require("../db");
const { migrate, genRefCode } = require("../schema");

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    if (key === "owner" || key === "help") {
      out[key] = true;
      continue;
    }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith("--")) {
      out[key] = true;
      continue;
    }
    out[key] = val;
    i += 1;
  }
  return out;
}

function usage(msg) {
  if (msg) console.error(`\n  error: ${msg}`);
  console.error(
    "\n  Usage: npm run create-user -- --email <email> --password <pass> [options]" +
      "\n" +
      "\n    --username <name>   (default: email prefix)" +
      "\n    --password <pass>   required, min 6 characters" +
      "\n    --country <name>    (default: Cameroon)" +
      "\n    --balance <n>       set wallet balance in XAF" +
      "\n    --owner             print the OWNER_EMAIL env line" +
      "\n"
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help) {
    usage();
    return;
  }

  const email = String(args.email || "").trim().toLowerCase();
  const password = String(args.password || "");
  const username = String(args.username || email.split("@")[0] || "").trim();
  const country = String(args.country || "Cameroon").trim();
  const balance =
    args.balance === undefined ? null : Math.round(Number(args.balance));

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) usage("a valid --email is required");
  if (!password || password.length < 6) usage("--password is required (min 6 characters)");
  if (!username || username.length < 3) usage("--username must be at least 3 characters");
  if (balance !== null && !Number.isFinite(balance)) usage("--balance must be a number");

  console.log(`[db] ${db.dialect}${db.file ? ` (${db.file})` : ""}`);
  await migrate();

  const password_hash = await bcrypt.hash(password, 10);
  const existing = await db.get(
    `SELECT id, username, email FROM users WHERE lower(email) = ?`,
    [email]
  );

  let userId;
  let created = false;

  if (existing) {
    userId = existing.id;
    await db.run(`UPDATE users SET password_hash = ?, country = ? WHERE id = ?`, [
      password_hash,
      country,
      userId,
    ]);
  } else {
    const info = await db.run(
      `INSERT INTO users (username, email, password_hash, created_at, country, referral_code)
       VALUES (?,?,?,?,?,?)`,
      [username, email, password_hash, Date.now(), country, genRefCode()]
    );
    userId = info.lastID;
    created = true;
  }

  await db.run(`INSERT OR IGNORE INTO wallets (user_id) VALUES (?)`, [userId]);

  if (balance !== null) {
    await db.run(`UPDATE wallets SET balance = ? WHERE user_id = ?`, [
      balance,
      userId,
    ]);
    await db.run(
      `INSERT INTO transactions (user_id, type, amount, note, ref, created_at)
       VALUES (?,?,?,?,?,?)`,
      [userId, "deposit", balance, "Set by scripts/create-user.js", "cli", Date.now()]
    );
  }

  const wallet = await db.get(`SELECT balance FROM wallets WHERE user_id = ?`, [userId]);

  console.log("");
  console.log(created ? "  ✅ user created" : "  ✅ user updated (password reset)");
  console.log(`     id        ${userId}`);
  console.log(`     username  ${created ? username : existing.username}`);
  console.log(`     email     ${email}`);
  console.log(`     country   ${country}`);
  console.log(`     balance   ${wallet.balance} XAF`);
  console.log(`     password  (as supplied on the command line)`);

  if (args.owner || process.env.OWNER_EMAIL === email) {
    console.log("");
    console.log("  To make this the OWNER account (unlocks the Owner dashboard");
    console.log("  on the Wallet page), add this to your .env / Render env vars:");
    console.log("");
    console.log(`     OWNER_EMAIL=${email}`);
  }

  console.log("");
  console.log("  Log in at http://localhost:3000/login.html");
  console.log("");

  await db.close();
}

main().catch(async (err) => {
  console.error("\n  Failed:", err.message, "\n");
  try {
    await db.close();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
