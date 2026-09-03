-- ---------------------------------------------------------------------------
-- Migration 001 - integrations.shopify_pending_installs
--
-- Owned by backend-fastapi, not Django. This table is the staging area
-- between the Shopify app's install callback (../frontend/app/oms.server.js,
-- which INSERTs into it directly over plain SQL) and this service's
-- GET/POST /api/integrations/shopify/pending (app/routers/pending.py, which
-- selects/updates it). Every column below exists because one of those two
-- call sites reads or writes it - see the mapping in each column's comment.
--
-- Columns, types and the RLS policy shape were taken from the LIVE schema
-- (integrations.shopify_connections, core.organizations, core.memberships),
-- not copied from the old Django migration proposal in
-- backend/integrations/migrations/. Two deliberate departures from that old
-- proposal, both explained where they happen below:
--   1. character varying instead of text, matching every sibling table.
--   2. the (organization_id, status) index also carries installed_at, because
--      that's the exact ORDER BY the FastAPI query uses.
--
-- No OAuth "state" column: this service never participates in the Shopify
-- OAuth handshake. That's validated entirely inside the Shopify app's own
-- SDK (Prisma-backed session storage in ../frontend) before oms.server.js's
-- afterAuth hook - the only writer of this table - ever runs. Adding a state
-- column here would be dead weight with no code path to use it.
-- ---------------------------------------------------------------------------

create schema if not exists integrations;

create table if not exists integrations.shopify_pending_installs (
    id                  uuid primary key default gen_random_uuid(),

    -- Natural key. One staged install per store; a reinstall/token-refresh
    -- upserts the same row (oms.server.js: `on conflict (shop_domain)`).
    shop_domain         character varying not null unique,
    shop_name           character varying not null default '',
    currency            character varying not null default '',

    -- Captured at OAuth completion, never written by this service - only
    -- read (pending.py _fetch_pending) and blanked on uninstall
    -- (oms.server.js markUninstalled).
    access_token        character varying not null default '',
    webhook_secret       character varying not null default '',
    scopes               character varying not null default '',
    api_version           character varying not null default '',
    installed_by_email  character varying not null default '',

    -- Nullable on purpose: an install whose owner could not be matched by
    -- email must belong to nobody until claimed, not be guessed onto a
    -- tenant. ON DELETE SET NULL (not shopify_connections' plain NO ACTION)
    -- because that "belongs to nobody" state is a normal, expected value
    -- here, not a foreign-key-violation edge case.
    organization_id     uuid references core.organizations(id) on delete set null,

    -- 'email' = auto-matched at install, 'claimed' = merchant entered their
    -- OMS email in the embedded app, 'unassigned' = still NULL.
    match_method        character varying not null default 'unassigned',
    -- 'pending' -> 'connected' (pending.py connect_pending) or
    -- 'uninstalled' (oms.server.js markUninstalled).
    status               character varying not null default 'pending',
    -- Shown in the embedded app so support can identify an install without
    -- reading out an access token; generated per-insert by oms.server.js,
    -- not by a DB default.
    claim_code           character varying not null default '',

    installed_at         timestamptz not null default now(),
    updated_at           timestamptz not null default now(),
    uninstalled_at        timestamptz,

    constraint shopify_pending_installs_match_method_valid
        check (match_method in ('email', 'claimed', 'unassigned')),
    constraint shopify_pending_installs_status_valid
        check (status in ('pending', 'connected', 'uninstalled'))
);

-- Matches pending.py's exact query shape: WHERE organization_id = $1 AND
-- status = 'pending' ORDER BY installed_at DESC LIMIT 1.
create index if not exists shopify_pending_installs_org_status_installed_idx
    on integrations.shopify_pending_installs (organization_id, status, installed_at desc);

-- Same policy shape as integrations.shopify_connections (already live).
-- Note: the pooled Postgres role this service and the Shopify app connect
-- with (`postgres`) has BYPASSRLS, so this is defense-in-depth for other
-- access paths (e.g. PostgREST), not the primary guard - app/auth.py and
-- app/routers/pending.py filter organization_id explicitly on every query.
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
