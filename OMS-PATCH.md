# OMS patch proposal — one-click Shopify connect

**Nothing in `D:/OMS-FynkTech` has been modified.** Everything here is a proposal
for you to review and apply yourself.

This repo's Shopify app (`app/`, `shopify.app.toml`) is finished and does its
half of the job: on install it captures the store domain, the `shpat_` Admin API
token and the `shpss_` secret, and writes them into your Supabase database. This
patch is the OMS half — reading that row and turning it into a real
`ShopifyConnection` when the merchant presses **Connect**.

The `backend/` and `frontend/` folders here hold **only** those patch files.
They are not part of the Shopify app and nothing builds or runs them — the
Shopify app's own server and UI code both live in `app/`. See README-OMS.md for
the app itself.

## What the merchant experiences once both halves are live

1. Installs **FynkTech AI** from the Shopify App Store.
2. Grants the scope set in `shopify.app.toml` on Shopify's own consent screen.
3. The app matches the store owner's email to their OMS organization and stages
   the credentials. If it can't match, the embedded app asks for their OMS email.
4. They open the OMS → **Integrations → Shopify** and see a card: *"Shopify store
   ready to connect"*.
5. They press **Connect**. The OMS verifies the token against `shop.json`,
   registers the order webhooks, and writes `ShopifyConnection` — the same code
   path as today's manual form, just without the copy-paste.

## Files

`backend/` and `frontend/` mirror the OMS's own layout, so every file sits at
the same path it is destined for inside `D:/OMS-FynkTech`.

| File here | Goes to, in the OMS |
| --- | --- |
| `backend/integrations/migrations/0010_shopifypendinginstall.py` | copy as-is |
| `backend/integrations/models_addition.py` | append the class to `backend/integrations/models.py` |
| `backend/integrations/views_addition.py` | append the view to `backend/integrations/views.py` (merge the imports) |
| `backend/integrations/urls_addition.py` | add the one `path(...)` to `backend/integrations/urls.py` |
| `frontend/integrationsService_addition.js` | add both methods to `frontend/services/integrationsService.js` |
| `frontend/PendingInstallCard.jsx` | paste into `frontend/app/(tenant)/integrations/shopify/page.jsx` |
| `backend/integrations/migrations/0010_shopify_pending_installs.sql` | raw DDL — reference only, or for the Shopify app's `npm run oms:bootstrap` in dev |

Apply order: migration → model → view → url → frontend. Then:

```bash
cd backend && python manage.py migrate integrations
```

## Tenancy — the part worth reading closely

`ShopifyPendingInstall.organization` is **nullable**, which makes it the one
table in the OMS that is not a `TenantScopedModel`. That is deliberate: an
install whose owner we cannot identify must belong to *nobody* rather than being
guessed onto a tenant.

Two consequences:

- **`TenantManager` does not scope it for you.** Every queryset must filter
  `organization_id` explicitly. `ShopifyPendingInstallView` does, in
  `_pending_for_org`. Anything you add later must too.
- **The RLS policy fails closed for unassigned rows.** `organization_id = core.current_organization_id()`
  is `NULL` — never true — when the column is `NULL`, so a row nobody has claimed
  is invisible to every tenant. That is the intended behaviour, not a bug to fix.

Matching runs against `auth.users` → `core.memberships`. A user who belongs to
two active organizations is treated as **no match**, because picking one would
put a merchant's Admin token on someone else's dashboard.

## Things to decide before this goes live

**1. `read_all_orders` needs Shopify's approval.** Without it the Admin API only
returns orders from the last 60 days, which makes your historical backfill
(`ShopifySyncJob` mode `full` / `backfill`) silently incomplete. Request it in the
Partner Dashboard under the app's API access page, and expect to justify it.

**2. `read_customers` is protected customer data.** An App Store listing needs
the protected customer data application approved, plus a privacy policy and data
retention answers. Budget review time.

**3. Your Shopify client is REST; new public apps are required to be GraphQL.**
`backend/integrations/shopify_client.py` calls `/admin/api/{v}/orders.json` and
friends. Shopify's rule is *"starting April 1 2025, all new public apps must be
built exclusively with the GraphQL Admin API"*. The REST order endpoints still
function, but this is a real risk for App Store review and a migration you will
eventually have to do. It does not block this patch — flagging it because you
picked App Store distribution.

**4. Offline tokens are pinned to non-expiring.** The app sets
`expiringOfflineAccessTokens: false` in `app/shopify.server.js`. `ShopifyConnection`
stores one static `access_token` with no refresh path, so expiring tokens would
break every sync ~24h after connect. If you ever want the rotating tokens, the
OMS needs a refresh mechanism first.

**5. Secrets are plaintext at rest**, matching the caveat already on
`ShopifyConnection`. This patch does not make that worse, but it does add a
second table holding tokens. If you add field-level encryption, do both together.

## Optional refactor

`ShopifyPendingInstallView.post` duplicates ~30 lines of
`ShopifyConnectionView.post` (verify → register webhooks → upsert). I kept the
patch additive so it can't break your existing connect flow. The cleaner end
state is to pull those lines into
`services.establish_shopify_connection(organization_id, shop_domain, access_token, webhook_secret)`
and have both views call it. Worth doing once you're happy the new path works.
