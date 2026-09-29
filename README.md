# VortexBoost

Social-media boosting platform — wallet, orders, CAMPay payments, and a
Simmwiz reseller engine.

One Node process serves **both** the REST API and the static frontend, so a
single Render web service is all you need to deploy.

---

## Quick start

```bash
npm install
cp .env.example .env     # optional — sensible dev defaults are built in
npm start                # http://localhost:3000
```

Requires **Node 22.5+** (the app uses the built-in `node:sqlite` module — no
native compilation, so `npm install` is fast and reliable). Pinned to Node
24.21.0 via `.node-version`.

Then open <http://localhost:3000/register.html>, create an account, and top up
from the Payment page.

**Reset a password / create an account from the terminal:**

```bash
npm run create-user -- --email you@example.com --password secret123 --balance 25000
```

---

## What you still need to add

The app boots and is fully browsable with **no** configuration. It becomes a
real store once these are set (in `.env` locally, or the Render dashboard):

| What | Variables | Without it |
|---|---|---|
| **Payment** | `CAMPAY_API_KEY`, `CAMPAY_SECRET`, `CAMPAY_MERCHANT_ACCOUNT` | The payment page refuses to take money (says "payments are being configured") |
| **Order fulfilment** | `SIMMWIZ_API_URL`, `SIMMWIZ_API_KEY` | Orders are **refused** — customers are never charged |
| **Logins** | `JWT_SECRET` | Required in production; the app refuses to boot with the insecure default |

### Ordering the last piece: mapping services to Simmwiz

Even with your Simmwiz key set, each catalog entry needs a numeric provider
service id before it can be sold. Find them with:

```bash
npm run simmwiz-services            # list everything your Simmwiz account can resell
npm run simmwiz-services -- --map   # + suggest an id for each unmapped catalog entry
```

Then paste the ids you trust into `catalog.json`:

```json
"avg": {
  "label": "Average Quality Followers",
  "pricePer1k": 3200,
  "costPer1k": 2100,
  "simmwizService": "1234",
  "qty": { "min": 100, "max": 100000 },
  "time": "1 Hour"
}
```

Until an entry is mapped it shows as unavailable and orders for it are
refused — **the customer is not charged**. The startup banner reports how many
services are mapped.

---

## Project layout

```
.
├── server.js              # Express API + static file server
├── db.js                  # Data layer — Postgres OR SQLite, one API
├── schema.js              # Tables + migrations (shared by server and scripts)
├── catalog.json           # Service catalog — pricing + Simmwiz ids
├── render.yaml            # Render Blueprint
├── scripts/
│   ├── create-user.js     # create / reset an account from the CLI
│   └── simmwiz-services.js# list provider services + suggest mappings
├── test/                  # node:test suites (npm test)
├── index.html …           # 12 static pages, served from the repo root
├── src/css/  src/js/
├── Public/Images/
└── data.db                # SQLite file — gitignored, auto-created on boot
```

Every page loads `src/js/config.js` → `app-shell.js` → its own page script.

---

## Database

`db.js` picks its backend automatically:

| Condition | Backend | Durability |
|---|---|---|
| `DATABASE_URL` set | **PostgreSQL** | Survives redeploys, restarts and spin-downs on any Render plan |
| `DATABASE_URL` unset | **SQLite** | Lives at `DB_PATH` (default `./data.db`) |

Both expose the same `run` / `get` / `all` API, so application code is
identical either way. Write queries with `?` placeholders; the Postgres side
rewrites them to `$1, $2, …`, converts `INSERT OR IGNORE` to
`ON CONFLICT DO NOTHING`, and appends `RETURNING id` so `lastID` works just
like SQLite's `lastInsertRowid`.

### ⚠️ Render's filesystem is ephemeral

Local files are erased on **every redeploy, restart, and idle spin-down**. With
plain SQLite on the service disk, that means all users, wallets, orders and
deposits are lost. Free web services **cannot** attach a persistent disk.

`render.yaml` therefore enables **Postgres** by default. Two options:

- **A — Postgres** (enabled in `render.yaml`, works on the free plan).
  Durable. ⚠️ The free Postgres tier **expires 30 days after creation** and is
  then deleted, after a 14-day upgrade grace period.
- **B — SQLite + persistent disk.** Cheaper to reason about, no Postgres.
  Requires a **paid** web service. Uncomment the `disk:` block in
  `render.yaml`, add `DB_PATH=/var/data/data.db`, and remove the `databases:`
  section plus `DATABASE_URL`.

Without either, treat the deployment as a throwaway demo.

---

## Deploying to Render

**Render Dashboard → New → Blueprint → pick this repo.** `render.yaml` creates
the web service and the database, and prompts for the `sync: false` secrets.

Manual equivalent:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Node version | 24.21.0 (via `.node-version`) |

`/api/health` reports real database connectivity, so a broken DB fails the
deploy instead of serving 500s behind a green check.

Point your CAMPay **webhook URL** at
`https://<your-app>.onrender.com/api/campay/webhook`. Payments are also
verified on demand, so a missed webhook still resolves when the customer taps
"Verify payment".

---

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `JWT_SECRET` | **production** | Signs login tokens. Generate with `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `DATABASE_URL` | no | Use Postgres instead of SQLite |
| `DB_PATH` | no | SQLite file location (use with a persistent disk) |
| `OWNER_EMAIL` | no | Account that sees the Owner dashboard (default `evaristusnuza@gmail.com`) |
| `SIMMWIZ_API_URL` | **to sell** | e.g. `https://www.simmwiz.com/api/v2` |
| `SIMMWIZ_API_KEY` | **to sell** | Your Simmwiz API key |
| `CAMPAY_API_KEY` / `CAMPAY_SECRET` / `CAMPAY_MERCHANT_ACCOUNT` | **to take money** | CAMPay credentials |
| `CAMPAY_BASE_URL` | no | Default `https://api.campayapp.com/v2` |
| `CORS_ORIGIN` | no | Only if the frontend is on a *different* domain. Comma-separated; same-origin needs nothing |
| `PORT` | no | Default `3000`; Render sets this |
| `ENABLE_TEST_DEPOSITS` | **dev only** | `1` = credit top-ups instantly with no payment. **App refuses to boot in production with this set** |
| `ALLOW_DEMO_ORDERS` | **dev only** | `1` = accept orders and fake-complete them with no provider. **App refuses to boot in production with this set** |
| `DEMO_ORDER_MS` | no | How fast a simulated order completes (default 90000) |

---

## Safety behaviour

Designed so a half-configured deploy cannot take money it cannot honour:

- **No provider → no charge.** If Simmwiz is unconfigured, or a specific
  service has no `simmwizService` id, the order is refused with HTTP 503
  *before* the wallet is touched.
- **Production refuses to boot** without `JWT_SECRET`, or with
  `ENABLE_TEST_DEPOSITS=1`, or with `ALLOW_DEMO_ORDERS=1`.
- **Rate limiting** on login, registration and password change (20 requests /
  15 min / IP), and on order, deposit and public-API writes (60 / min).
- **Provider rejections auto-refund** the customer's wallet.
- **Canceled provider orders auto-refund**, and refunds are idempotent.
- **Graceful shutdown** on `SIGTERM`/`SIGINT` — Render sends `SIGTERM` on every
  redeploy, so in-flight requests finish and SQLite flushes cleanly.
- Stock CORS allows **same-origin only**; no `X-Frame-Options`/CSP framing
  headers so the site still works inside embedded previews.

---

## Tests

```bash
npm test
```

29 tests, no network or database server required:

- `test/sqlite.test.js` — runs against a **real** SQLite database: schema,
  re-migration on every boot, legacy-user backfill, unique-constraint
  behaviour, the atomic wallet debit guard.
- `test/postgres.test.js` — exercises the Postgres SQL we generate using
  `pg-mem`, an in-process Postgres emulator: `SERIAL` DDL, `$n` rewriting,
  `ON CONFLICT DO NOTHING`, `RETURNING id`, and `int8`→`number` coercion.

⚠️ `pg-mem` is not Postgres. It confirms the SQL we emit is Postgres-shaped,
but the connection layer is only truly proven by deploying against a real
Render Postgres. Two known emulator gaps are documented in the test file
(it mis-evaluates `balance - $1` in an `UPDATE SET`, and rejects a repeated
`CREATE TABLE IF NOT EXISTS`); neither affects real Postgres.

---

## Public API

Customers generate a key on the **API** page and authenticate with
`X-Api-Key`:

| Method | Endpoint |
|---|---|
| `GET` | `/api/public/services` |
| `GET` | `/api/public/balance` |
| `POST` | `/api/public/add` — `{ "service": "tiktok.followers.avg", "link": "…", "quantity": 500 }` |
| `GET` | `/api/public/status?order=ID` |

---

## How the money moves

```
customer tops up wallet ──(CAMPay)──► customer wallet
customer places order  ──► wallet debited at YOUR price (catalog pricePer1k)
                     └──► Simmwiz "add" order at provider rate (your Simmwiz balance pays)
canceled provider order ──► automatic full refund to customer wallet
your margin = customer price − Simmwiz cost   (see Wallet → Owner dashboard)
```

---

## Security notes

- **Rotate the owner password.** Early commits tracked `data.db`, which
  contained the `evaristusnuza@gmail.com` account and its bcrypt hash. The
  file is now untracked and gitignored, but **it remains in Git history**.
  Change that password; consider `git filter-repo` if the repo is public.
- `.env` is gitignored — keep real keys out of Git.
