-- ---------------------------------------------------------------------------
-- Migration 002 - expiring offline token support
--
-- Shopify requires expiring offline access tokens for public apps (new apps
-- from April 1 2026, all public apps from January 1 2027 - see
-- https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens).
-- ../frontend/app/shopify.server.js now sets expiringOfflineAccessTokens: true,
-- so afterAuth receives a refresh_token alongside the access_token
-- (../frontend/app/oms.server.js::savePendingInstall stages it here).
--
-- backend-fastapi is the sole owner of ongoing refresh (app/shopify_client.py
-- ::refresh_access_token, scripts/refresh_tokens.py) - the frontend app's own
-- Prisma session also auto-refreshes independently on every embedded page
-- load, and Shopify's docs warn that two independent refreshers for the same
-- store can retire each other's token. Columns land on both tables because
-- shopify_pending_installs is where the frontend first stages them and
-- shopify_connections is what backend-fastapi actually refreshes going
-- forward - see routers/pending.py::connect_pending, which now carries them
-- from one table to the other on connect.
-- ---------------------------------------------------------------------------

alter table integrations.shopify_pending_installs
    add column if not exists refresh_token            character varying not null default '',
    add column if not exists access_token_expires_at   timestamptz,
    add column if not exists refresh_token_expires_at  timestamptz;

alter table integrations.shopify_connections
    add column if not exists refresh_token            character varying not null default '',
    add column if not exists access_token_expires_at   timestamptz,
    add column if not exists refresh_token_expires_at  timestamptz;
