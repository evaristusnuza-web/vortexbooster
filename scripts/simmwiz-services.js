#!/usr/bin/env node
/* ============================================================
   Ask Simmwiz for the list of services your account can resell,
   then show which of YOUR catalog entries still need a
   `simmwizService` id — with a best-guess suggestion for each.

   Usage:
     npm run simmwiz-services              # list provider services
     npm run simmwiz-services -- --map     # also suggest catalog mappings

   Requires SIMMWIZ_API_URL and SIMMWIZ_API_KEY (in .env or the env).

   Nothing is written automatically: a wrong mapping means customers
   would be charged for a different service than they picked. Copy the
   ids you trust into catalog.json by hand.
   ============================================================ */

require("dotenv").config({ quiet: true });

const path = require("path");
const fs = require("fs");

const CATALOG_PATH = path.join(__dirname, "..", "catalog.json");
const CATALOG = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));

const API_URL = process.env.SIMMWIZ_API_URL || "";
const API_KEY = process.env.SIMMWIZ_API_KEY || "";

const args = process.argv.slice(2);
const wantMapping = args.includes("--map");

/* ----------------------------- helpers ----------------------------- */

async function fetchServices() {
  if (!API_URL || !API_KEY) {
    console.error(
      "\n  Simmwiz is not configured.\n" +
        "  Set SIMMWIZ_API_URL and SIMMWIZ_API_KEY — either in a .env file\n" +
        "  in the project root, or in your shell / Render environment.\n"
    );
    process.exit(1);
  }

  console.log(`\n  Querying ${API_URL} …\n`);

  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ key: API_KEY, action: "services" }),
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`  Could not parse the response as JSON (HTTP ${res.status}):\n`);
    console.error("  " + text.slice(0, 500));
    console.error(
      "\n  Double-check SIMMWIZ_API_URL — for most SMM panels it should end\n" +
        "  in /api/v2 (no trailing slash), e.g. https://www.simmwiz.com/api/v2\n"
    );
    process.exit(1);
  }

  if (data && data.error) {
    console.error(`  Simmwiz returned an error: ${data.error}\n`);
    process.exit(1);
  }

  const list = Array.isArray(data) ? data : data.services || [];
  if (!list.length) {
    console.error("  Simmwiz returned no services for this API key.\n");
    process.exit(1);
  }
  return list;
}

const norm = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Loose name similarity: how many of `needle`'s words appear in `hay`. */
function score(needle, hay) {
  const words = norm(needle).split(" ").filter((w) => w.length > 2);
  if (!words.length) return 0;
  const target = norm(hay);
  const hit = words.filter((w) => target.includes(w)).length;
  return hit / words.length;
}

/* ------------------------------- main ------------------------------ */

async function main() {
  const services = await fetchServices();

  console.log(
    `  ${services.length} services available on your Simmwiz account:\n`
  );
  console.log(
    "  " +
      "ID".padEnd(9) +
      "RATE/1k".padEnd(11) +
      "NAME"
  );
  console.log("  " + "─".repeat(72));
  for (const s of services) {
    const id = String(s.service ?? s.id ?? "?");
    const rate = String(s.rate ?? "?");
    const name = String(s.name || "").slice(0, 52);
    console.log("  " + id.padEnd(9) + rate.padEnd(11) + name);
  }

  /* --------- which catalog entries still need an id? --------- */
  const unmapped = [];
  for (const [pKey, p] of Object.entries(CATALOG)) {
    if (pKey.startsWith("_")) continue;
    for (const [sKey, s] of Object.entries(p.services || {})) {
      for (const [tKey, t] of Object.entries(s.types || {})) {
        if (!t.pricePer1k || t.pricePer1k <= 0) continue;
        if (!t.simmwizService) {
          unmapped.push({
            key: `${pKey}.${sKey}.${tKey}`,
            label: `${s.label} - ${p.label} (${t.label})`,
            sellRate: t.pricePer1k,
            costPer1k: t.costPer1k || 0,
          });
        }
      }
    }
  }

  console.log("");
  if (!unmapped.length) {
    console.log("  ✅ Every sellable catalog entry already has a simmwizService id.\n");
    return;
  }

  console.log(
    `  ⚠  ${unmapped.length} catalog entr${unmapped.length === 1 ? "y" : "ies"} have no simmwizService id.`
  );
  console.log(
    "     Until they are mapped, those services are refused at checkout\n" +
      "     (the customer is not charged).\n"
  );

  if (!wantMapping) {
    console.log("  Run with --map to see suggested ids for each one:\n");
    console.log("     npm run simmwiz-services -- --map\n");
    return;
  }

  console.log("  Suggested mappings (ALWAYS verify before copying!):\n");

  for (const entry of unmapped) {
    const ranked = services
      .map((s) => ({
        id: String(s.service ?? s.id ?? ""),
        rate: Number(s.rate) || 0,
        name: String(s.name || ""),
        s: score(entry.label, s.name),
      }))
      .filter((c) => c.s > 0.3)
      .sort((a, b) => b.s - a.s)
      .slice(0, 3);

    console.log(`  ${entry.key}`);
    console.log(
      `    sell ${entry.sellRate} XAF/1k   (your cost placeholder: ${entry.costPer1k || "none"})`
    );
    if (!ranked.length) {
      console.log("    no close match — map this one by hand\n");
      continue;
    }
    for (const c of ranked) {
      const margin = entry.sellRate - c.rate;
      const flag = margin <= 0 ? "  <-- LOSS!" : "";
      console.log(
        `    ${(Math.round(c.s * 100) + "%").padEnd(5)} ${c.id.padEnd(8)} ` +
          `${String(c.rate).padEnd(9)} ${c.name.slice(0, 40)}` +
          `  margin ${margin} XAF/1k${flag}`
      );
    }
    console.log("");
  }

  console.log(
    "  Next: paste the ids you trust into catalog.json as\n" +
      '        "simmwizService": "<id>",\n' +
      "        and set costPer1k to the provider rate above.\n" +
      "  Then restart the app — it re-reads Simmwiz rates on boot.\n"
  );
}

main().catch((e) => {
  console.error("\n  Failed:", e.message, "\n");
  process.exit(1);
});
