# VortexBoost

Social-media boosting platform — wallet, orders, CAMPay payments, and a
Simmwiz reseller engine.

One Node process serves **both** the REST API and the static frontend, so a
single Render web service is all you need to deploy.

---

## Quick start (local)

```bash
npm install
npm start              # http://localhost:3000
```

Requires **Node 22.5+** (the app uses the built-in `node:sqlite` module — no
native compilation, so `npm install` is fast and reliable). Pinned to Node
24.21.0 via `.node-version`.

Useful dev env vars:

```bash
ENABLE_TEST_DEPOSITS=1   # credit deposits instantly, no CAMPay needed — DEV ONLY
DEMO_ORDER_MS=30000      # how fast the fake provider "completes" orders in demo mode
JWT_SECRET=dev-secret    # otherwise falls back to an insecure placeholder
```

Open <http://localhost:3000>, register an account, and use the Payment page to
top up — with `ENABLE_TEST_DEPOSITS=1` the balance is credited instantly.

---

## Project layout

```
.
├── server.js              # Express API + static file server (all routes)
├── db.js                  # SQLite access layer (node:sqlite)
├── catalog.json           # Service catalog — single source of truth for pricing
├── render.yaml            # Render Blueprint (deploy config)
├── index.html             # Landing page
├── login.html             # …plus 11 more pages, served from the repo root
├── src/
│   ├── css/               # Stylesheets
│   └── js/
│       ├── config.js      # Sets window.API_BASE — loaded first on every page
│       ├── app-shell.js   # Shared shell: auth guard, side menu, wallet in header
│       └── *-page.js      # Per-page logic
├── Public/Images/         # Icons and images
└── data.db                # SQLite database (gitignored, auto-created on boot)
```

Every page loads `src/js/config.js` → `app-shell.js` → its own page script.

---

## Environment variables

| Variable | Required | What it is |
|---|---|---|
| `JWT_SECRET` | **yes** | Long random string for signing login tokens |
| `OWNER_EMAIL` | no | Your account email (default `evaristusnuza@gmail.com`). That account sees the **Owner dashboard** on the Wallet page |
| `SIMMWIZ_API_URL` | yes* | Simmwiz API endpoint, e.g. `https://www.simmwiz.com/api/v2` |
| `SIMMWIZ_API_KEY` | yes* | Your Simmwiz API key |
| `CAMPAY_BASE_URL` | no | Default `https://api.campayapp.com/v2` |
| `CAMPAY_API_KEY` | yes* | CAMPay `X-Api-Key` |
| `CAMPAY_SECRET` | yes* | CAMPay `X-Secret-ApiKey` |
| `CAMPAY_MERCHANT_ACCOUNT` | yes* | Your CAMPay merchant account UUID |
| `ENABLE_TEST_DEPOSITS` | no | `"1"` = credit deposits instantly, no payment taken. **Never set in production** |

\* Until these are set the app runs in safe fallback modes:

- **Simmwiz not set** → *demo mode*: orders are accepted and marked
  **completed after ~90 s even though no provider order was ever placed**.
  ⚠️ This means customers are charged for orders that are never delivered.
- **CAMPay not set** → the payment page returns a friendly
  *"payments are being configured"* error instead of accepting money.

---

## Deploying to Render

The repo includes `render.yaml`, so: **Render Dashboard → New → Blueprint →
select this repo**. Then set the `sync: false` secrets in the dashboard.

Manual setup equivalent:

| Setting | Value |
|---|---|
| Runtime | Node |
| Build command | `npm install` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Node version | 24.21.0 (via `.node-version`) |

Point your CAMPay **webhook URL** at
`https://<your-render-app>/api/campay/webhook`.
The site also verifies payments manually, so a missed webhook still resolves
when the customer presses "Verify payment".

### ⚠️ Database options — read before taking real money

The app stores everything in **SQLite** (`data.db`). Render web-service
filesystems are **ephemeral**: local files are erased on every redeploy,
restart, and idle spin-down. Free web services *cannot* attach a persistent
disk. **As-is on the free tier, this configuration loses all user accounts,
wallets, orders and deposits on every restart or 15-minute idle spin-down.**

Pick one:

- **A — Persistent disk (smallest change).** Upgrade to a paid plan, uncomment
  the `disk:` block in `render.yaml`, and set `DB_PATH=/var/data/data.db` so
  the database lives on the mount.
- **B — Render Postgres (most robust).** Port `db.js` to Postgres and set
  `DATABASE_URL`. Data then survives on any plan. Note the free Postgres tier
  expires 30 days after creation.
- **C — Accept data loss (demo only).** Fine for a throwaway demo, never for
  real customers.

`db.js` currently opens `path.join(__dirname, "data.db")`. To support option A,
make that path env-driven:

```js
const DB_FILE = process.env.DB_PATH || path.join(__dirname, "data.db");
```

---

## Public API

Every customer can generate a personal API key on the **API** page and use:

| Method | Endpoint |
|---|---|
| `GET` | `/api/public/services` |
| `GET` | `/api/public/balance` |
| `POST` | `/api/public/add` — `{ "service": "tiktok.followers.avg", "link": "…", "quantity": 500 }` |
| `GET` | `/api/public/status?order=ID` |

Authenticate with an `X-Api-Key` header.

---

## How the money moves

```
customer tops up wallet ──(CAMPay)──► customer wallet
customer places order  ──► wallet debited at YOUR price (catalog pricePer1k)
                     └──► Simmwiz "add" order at provider rate (your Simmwiz balance pays)
canceled provider order ──► automatic full refund to customer wallet
your margin = customer price − Simmwiz cost   (see Wallet → Owner dashboard)
```

### Wiring the pricing

1. **Sell prices** — edit `catalog.json` (`pricePer1k` per type, in XAF).
2. **Simmwiz mapping** — paste the numeric **service IDs** from your Simmwiz
   dashboard into the matching `simmwizService` field in `catalog.json`.
   ⚠️ **All 26 catalog entries currently have an empty `simmwizService`.**
   Until they are filled in, no order ever reaches Simmwiz. `costPer1k` is the
   fallback cost used when the live Simmwiz rate can't be fetched.
3. **CAMPay** — add MTN MoMo / Orange Money (and crypto) in your CAMPay
   merchant dashboard, then set the three CAMPay env vars.

---

## Security notes

- **Rotate the owner password.** Earlier commits tracked `data.db`, which
  contained the `evaristusnuza@gmail.com` account and its bcrypt hash. Those
  files are now untracked and gitignored, but **they remain in Git history**.
  Change that password, and consider rewriting history
  (`git filter-repo`) if the repo is public.
- `ENABLE_TEST_DEPOSITS=1` credits wallets without taking payment. Never set
  it in production.
- Known gaps not yet addressed: no rate limiting on `/api/login` or
  `/api/register`, `cors()` allows all origins, and `JWT_SECRET` falls back to
  a placeholder instead of failing fast.
