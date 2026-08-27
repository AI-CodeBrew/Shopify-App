# FynkTech AI — OMS connector

This Shopify app exists to do one thing: when a merchant installs it, capture
the three values the FynkTech OMS needs and hand them over, so the merchant
never has to create a custom app or copy an access token by hand.

| OMS field | Where it comes from |
| --- | --- |
| `shop_domain` | `shop.myshopifyDomain` from the Admin API |
| `access_token` | the offline `shpat_` token from the OAuth exchange |
| `webhook_secret` | this app's own `shpss_` shared secret — Shopify signs webhooks with it |

## How the connection is made

```
merchant installs app
        │
        ▼
OAuth: all scopes in shopify.app.toml granted
        │
        ▼
hooks.afterAuth  (app/shopify.server.js)
        │  reads shop { name, email, currencyCode, myshopifyDomain }
        │  matches email → auth.users → core.memberships → organization
        ▼
integrations.shopify_pending_installs   ← in the OMS's own Supabase Postgres
        │
        ├─ matched   → row carries organization_id, visible to that tenant
        └─ no match  → organization_id NULL, visible to nobody;
                       embedded app asks for the merchant's OMS email
        │
        ▼
merchant opens OMS → Integrations → Shopify → presses "Connect"
        │
        ▼
OMS verifies token, registers order webhooks, writes ShopifyConnection
```

The app **never** writes to `integrations.shopify_connections`. Going live stays
the OMS's decision, behind an authenticated user pressing Connect.

## Setup

```bash
cp .env.example .env      # then fill it in
npm install
npm run oms:doctor        # verifies env, scopes, and the OMS database
npm run dev
```

Required env — see `.env.example` for the full annotated list:

- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` — Partner Dashboard → API credentials
- `SHOPIFY_APP_URL` — your deployed URL; also replace the three `REPLACE-ME`
  placeholders in `shopify.app.toml`
- `SCOPES` — must stay identical to `[access_scopes].scopes` in the TOML;
  `npm run oms:doctor` fails if they drift
- `OMS_DATABASE_URL` — the same value as `DATABASE_URL` in the OMS's
  `backend/.env.backend`. Use the Supabase **session pooler** URI (port 5432);
  the transaction pooler rejects the prepared statements `pg` issues.
- `OMS_APP_URL` — where the "Open FynkTech OMS" button sends the merchant

### The OMS side

The staging table does not exist yet. Apply
`backend/integrations/migrations/0010_shopifypendinginstall.py`
through Django (preferred — it is the OMS's schema), or for a dev database only:

```bash
# set OMS_ALLOW_BOOTSTRAP=1 in .env first
npm run oms:bootstrap
```

Until the table exists the app installs fine but stages nothing, and the
embedded page says so rather than failing silently.

## Scopes

Requested in `shopify.app.toml`, grouped by the OMS module that consumes them:

- **Orders / OMS** — `read_orders`, `write_orders`, `read_all_orders`,
  `read_draft_orders`, `write_draft_orders`, `read_order_edits`, `write_order_edits`
- **Fulfilment / WMS** — `read_fulfillments`, `write_fulfillments`, and the three
  fulfilment-order pairs (assigned, merchant-managed, third-party), `read_locations`
- **Inventory** — `read_inventory`, `write_inventory`
- **Returns** — `read_returns`, `write_returns`
- **Catalogue** — `read_products`, `write_products`
- **Customers** — `read_customers`, `write_customers`
- **Shipping** — `read_shipping`, `write_shipping`
- **Finance** — `read_shopify_payments_payouts`, `read_shopify_payments_disputes`,
  `read_price_rules`, `read_discounts`

### Protected scopes — these gate your App Store listing

- **`read_all_orders`** must be requested and approved in the Partner Dashboard.
  Without it the Admin API returns only the last 60 days of orders, which makes
  the OMS's historical backfill quietly incomplete.
- **`read_customers` / `write_customers`** fall under Shopify's protected
  customer data rules: a separate application, a privacy policy, and answers on
  data retention.

Shopify reviews scope requests against what your app demonstrably does. Trim any
scope the OMS does not actually call — an over-broad list is a common rejection
reason.

## Notes

- **`expiringOfflineAccessTokens` is off** (`app/shopify.server.js`). The OMS
  stores one static token per store with no refresh path; rotating tokens would
  break every sync about a day after connect.
- **Privacy webhooks** are implemented in `app/routes/webhooks.compliance.jsx`
  and declared in the TOML. Shopify sends signed test payloads to that URL during
  review and rejects listings without all three. This app holds no buyer data, so
  only `shop/redact` does real work.
- **Prisma/SQLite** is only the app's own OAuth session store. Switch it to
  Postgres before production — SQLite does not survive most container deploys.
- `npm run oms:doctor` is the first thing to run when an install "worked" but
  nothing appeared in the OMS.
