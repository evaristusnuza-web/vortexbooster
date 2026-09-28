# VortexBoost — setup guide

Single Node app: the Express server serves **both** the API and the static
frontend, so one deployment (Render) is enough.

## Requirements
- **Node.js 22.5+** (the app uses the built-in `node:sqlite` module — no
  native compilation, `npm install` is fast and reliable)

## Run locally
```bash
npm install
npm start            # http://localhost:3000
```

Useful local env vars:
```bash
ENABLE_TEST_DEPOSITS=1   # credits deposits instantly (NO CAMPay needed) — DEV ONLY
DEMO_ORDER_MS=90000      # how fast the fake provider "completes" orders in demo mode
```

## Environment variables (set in Render)

| Variable                | Required | What it is |
|-------------------------|----------|------------|
| `JWT_SECRET`            | **yes**  | Long random string for signing login tokens |
| `OWNER_EMAIL`           | no       | Your account email (default `evaristusnuza@gmail.com`). That account sees the **Owner dashboard** on the Wallet page (deposits, provider cost, net margin) |
| `SIMMWIZ_API_URL`       | yes*     | Your Simmwiz API endpoint, e.g. `https://www.simmwiz.com/api/v2` |
| `SIMMWIZ_API_KEY`       | yes*     | Your Simmwiz API key |
| `CAMPAY_BASE_URL`       | no       | Default `https://api.campayapp.com/v2` |
| `CAMPAY_API_KEY`        | yes*     | CAMPay `X-Api-Key` |
| `CAMPAY_SECRET`         | yes*     | CAMPay `X-Secret-ApiKey` |
| `CAMPAY_MERCHANT_ACCOUNT` | yes*   | Your CAMPay merchant account uuid |
| `ENABLE_TEST_DEPOSITS`  | no       | Set `"1"` in dev to skip CAMPay entirely. **Never set in production** |

\* until these are set the app runs in safe fallback modes:
- **Simmwiz not set** → demo mode: orders are accepted, marked *completed*
  after ~90 s (no real provider order is placed).
- **CAMPay not set** → the payment page returns a friendly
  "payments are being configured" error instead of accepting money.

## Wiring your business flow

1. **Sell prices** — edit `catalog.json` (`pricePer1k` per type, in XAF).
   This file is the single source of truth for the website, the API and
   the orders engine.
2. **Simmwiz mapping** — in Simmwiz's dashboard note the numeric **service
   IDs** for each service you resell and paste them into the matching
   `simmwizService` field in `catalog.json` (e.g. `"simmwizService": "1234"`).
   `costPer1k` is the fallback cost used when the live Simmwiz rate can't be
   fetched; the live rate from Simmwiz is used automatically when available.
3. **CAMPay** — create your merchant account at CAMPay, add the MTN MoMo /
   Orange Money (and crypto) methods, and put the three keys above in Render.
   Point your CAMPay **webhook URL** at `https://<your-render-app>/api/campay/webhook`.
   (The site also verifies payments manually, so a missed webhook still
   resolves when the customer presses "Verify payment".)

### How the money moves
```
customer tops up wallet ──(CAMPay)──► customer wallet
customer places order  ──► wallet debited at YOUR price (catalog pricePer1k)
                     └──► Simmwiz "add" order at provider rate (your Simmwiz balance pays)
canceled provider order ──► automatic full refund to customer wallet
your margin = customer price − Simmwiz cost   (see Wallet → Owner dashboard)
```

## Public API (the "API" menu page)
Every customer can generate a personal API key and use:
- `GET  /api/public/services`
- `GET  /api/public/balance`
- `POST /api/public/add`        `{ "service": "tiktok.followers.avg", "link": "...", "quantity": 500 }`
- `GET  /api/public/status?order=ID`

## Deployment notes
- **Render:** root directory = repo root, build command `npm install`,
  start command `npm start`, Node runtime 22. Health check path: `/api/health`.
- Your old `backend/` folder (PostgreSQL variant) is kept but **no longer
  used** — delete it if you're sure nothing points at it.
- `data.db` (SQLite file) is auto-created/migrated on boot. On Render's
  free tier the disk is ephemeral — for permanent user data attach a
  persistent disk or switch the DB layer in `db.js` to Postgres.
