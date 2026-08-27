-- ---------------------------------------------------------------------------
-- integrations.shopify_pending_installs
--
-- Staging table the FynkTech AI Shopify app writes into when a merchant
-- installs it. The OMS reads it to offer a one-click "Connect" instead of
-- asking the merchant to paste a domain, an shpat_ token and an shpss_ secret
-- by hand.
--
-- This is NOT integrations.shopify_connections. Nothing here is live until a
-- signed-in OMS user presses Connect, at which point the existing
-- ShopifyConnectionView.post logic promotes the row (verifying the token
-- against shop.json and registering webhooks) exactly as it does today for a
-- hand-typed form.
--
-- Tenancy: organization_id is NULLABLE on purpose. The app matches the
-- installing staff member's email against auth.users -> core.memberships; when
-- that match is missing or ambiguous the column stays NULL. Combined with the
-- standard tenant-isolation policy below, a NULL-org row is visible to no
-- tenant at all, which is the desired fail-closed behaviour: an unmatched
-- install must never surface on someone else's dashboard.
--
-- Secrets at rest: access_token and webhook_secret are stored plaintext, the
-- same caveat already documented on integrations.shopify_connections. If you
-- add field-level encryption there, add it here in the same change.
-- ---------------------------------------------------------------------------

create schema if not exists integrations;

create table if not exists integrations.shopify_pending_installs (
    id                 uuid primary key default gen_random_uuid(),
    shop_domain        text        not null unique,
    shop_name          text        not null default '',
    currency           text        not null default '',
    access_token       text        not null default '',
    webhook_secret     text        not null default '',
    scopes             text        not null default '',
    api_version        text        not null default '',
    installed_by_email text        not null default '',

    organization_id    uuid        references core.organizations(id) on delete set null,
    -- How organization_id was decided: 'email' (auto-matched at install),
    -- 'claimed' (merchant entered their OMS email in the embedded app),
    -- 'unassigned' (still NULL). Kept for support: it answers "why did this
    -- store land on this tenant?" without digging through logs.
    match_method       text        not null default 'unassigned',
    -- 'pending'   - staged, waiting for someone to press Connect
    -- 'connected' - promoted into integrations.shopify_connections
    -- 'uninstalled' - app removed from the store; access_token blanked
    status             text        not null default 'pending',
    claim_code         text        not null default '',

    installed_at       timestamptz not null default now(),
    updated_at         timestamptz not null default now(),
    uninstalled_at     timestamptz,

    constraint shopify_pending_installs_match_method_valid
        check (match_method in ('email', 'claimed', 'unassigned')),
    constraint shopify_pending_installs_status_valid
        check (status in ('pending', 'connected', 'uninstalled'))
);

-- The OMS integrations page reads "is there a pending install for my org?" on
-- every load; without this it is a seq scan on a table that only ever grows.
create index if not exists shopify_pending_installs_org_status_idx
    on integrations.shopify_pending_installs (organization_id, status);

-- Same policy shape as every other tenant table (see core/rls.py). Defense in
-- depth for direct Postgres/PostgREST access; Django's own protection is
-- TenantScopedModel + TenantMiddleware, since the pooler role has BYPASSRLS.
alter table integrations.shopify_pending_installs enable row level security;
alter table integrations.shopify_pending_installs force row level security;

drop policy if exists shopify_pending_installs_tenant_isolation
    on integrations.shopify_pending_installs;

create policy shopify_pending_installs_tenant_isolation
    on integrations.shopify_pending_installs
    for all
    using (
        core.is_super_admin()
        or organization_id = core.current_organization_id()
    )
    with check (
        core.is_super_admin()
        or organization_id = core.current_organization_id()
    );
