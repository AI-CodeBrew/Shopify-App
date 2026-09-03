# FynkTech AI - OMS connector (FastAPI)

A standalone Python replacement for the Django patch proposed in
`../backend/OMS-PATCH.md`. It reads `integrations.shopify_pending_installs`
(written by `../frontend/app/oms.server.js` when a merchant installs the
Shopify app) and, when an OMS user presses **Connect**, verifies the token,
registers order webhooks, and upserts `integrations.shopify_connections` -
all on the **same Supabase Postgres** the OMS and the Shopify app already
use. Nothing about the Shopify app or the OMS database changes; this is an
additional, independent service reading/writing the same tables the Django
patch would have.

## Endpoints

- `GET  /health` - read-only DB/table checks, no auth required.
- `GET  /api/integrations/shopify/pending` - is there a staged install for my org?
- `POST /api/integrations/shopify/pending` - promote it into a real connection.
- `POST /webhooks/shopify/orders` - HMAC-verified receiver for the webhooks this
  service registers on connect. Stub: verifies + logs, does not yet write OMS
  order rows (that's real OMS business logic, out of scope for a connector).

`GET`/`POST /api/integrations/shopify/pending` require `Authorization: Bearer
<supabase-jwt>` - the same access token the OMS frontend already holds after
Supabase Auth login. The organization is read from the JWT's
`app_metadata.organization_id` claim (falling back to `user_metadata`),
exactly like `core.current_organization_id()` does in Postgres, then
cross-checked against `core.memberships`.

## Setup

```bash
cd backend-fastapi
python -m venv .venv
.venv\Scripts\activate        # Windows; use `source .venv/bin/activate` on macOS/Linux
pip install -r requirements.txt
cp .env.example .env          # fill in DATABASE_URL and SUPABASE_JWT_SECRET
```

- `DATABASE_URL` - same value as `OMS_DATABASE_URL` in `../frontend/.env`.
- `SUPABASE_JWT_SECRET` - Supabase project settings > API > JWT Settings >
  Legacy JWT Secret. Not stored in Postgres, so it has to come from the
  dashboard (or from whatever env var the Django OMS already uses for it).
  If this Supabase project has migrated to the newer asymmetric JWT signing
  keys, `app/auth.py` needs to verify against the JWKS endpoint instead of a
  shared HS256 secret.
- `PUBLIC_BACKEND_URL` - must be a URL Shopify can reach when it calls back
  with webhooks. `localhost` will not work past the `/health` check; use a
  tunnel (ngrok/cloudflared) during local testing, matching how `shopify app
  dev` tunnels the frontend.
- `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` - same values as `../frontend`'s.
  Only used by `refresh_access_token` (`scripts/refresh_tokens.py`), which
  authenticates as the app itself, not as any one merchant.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```

Then:

```bash
curl http://localhost:8000/health
```

should report `"ok": true` with all three tables present, once
`integrations.shopify_pending_installs` exists (see
`../frontend/README-OMS.md` - `npm run oms:bootstrap` or the Django
migration).

## Expiring offline tokens and refresh

Shopify requires expiring offline access tokens for public apps (new apps
from April 1 2026, all public apps from January 1 2027). `../frontend/app/shopify.server.js`
requests one (`expiringOfflineAccessTokens: true`), and `oms.server.js` stages
the `refresh_token` alongside the `access_token` in `shopify_pending_installs`.
`connect_pending` carries both into `shopify_connections`.

**This service is the sole owner of ongoing refresh** - run
`scripts/refresh_tokens.py` on a schedule (cron / Task Scheduler, every
15-30 minutes is safe):

```bash
python scripts/refresh_tokens.py
```

It refreshes any connection within 6 hours of its access token expiring, and
sets `is_connected = false` on a connection whose `refresh_token` Shopify
rejects outright (see `app/shopify_client.py::InvalidRefreshTokenError`) -
that's what surfaces on the OMS side as needing reauthorization, rather than
failing silently forever.

**Why not the frontend app too:** the React Router app's own session
(Prisma) already auto-refreshes independently on every embedded page load
via the Shopify library's built-in behavior. Shopify's docs are explicit that
acquiring or refreshing a token from two independent places for the same
store can retire each other's copy, so this service deliberately doesn't try
to coordinate with that - it treats a rejected refresh_token as a signal to
ask the merchant to reconnect, not as a bug to chase.

## Known gap vs. the Django patch

`ShopifyConnection.auto_sync_orders` has no database default, and its Django
model isn't in this repo to check the field's actual default - `routers/pending.py`
assumes `true` on a fresh connect (existing rows are left untouched on
reconnect). Confirm this matches the real model before this goes anywhere
near production.
