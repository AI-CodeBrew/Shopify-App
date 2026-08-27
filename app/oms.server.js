/**
 * Bridge between this Shopify app and the FynkTech OMS.
 *
 * The OMS is multi-tenant and resolves `organization_id` exclusively from a
 * logged-in user's Supabase JWT (backend/core/middleware.py). A Shopify
 * install callback has no such JWT, so it cannot call the OMS's
 * POST /api/integrations/shopify/ endpoint directly.
 *
 * Instead this module writes the captured credentials straight into the OMS's
 * own Supabase Postgres, into a staging table
 * (integrations.shopify_pending_installs) that the OMS reads. The row is
 * tenant-scoped by `organization_id`, matched from the installing staff
 * member's email. When no confident match exists the column stays NULL, and
 * because the table carries the same RLS policy as every other OMS table
 * (core/rls.py), a NULL-org row is visible to nobody until it is claimed.
 *
 * Nothing here ever writes to integrations.shopify_connections. Promoting a
 * pending install into a real connection stays the OMS's job, behind the
 * merchant pressing "Connect".
 */
import pg from "pg";

const { Pool } = pg;

/** Reuse one pool across HMR reloads in dev, as db.server.js does for Prisma. */
function getPool() {
  const url = process.env.OMS_DATABASE_URL;
  if (!url) return null;

  if (!global.omsPoolGlobal) {
    global.omsPoolGlobal = new Pool({
      connectionString: url,
      max: 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      // Supabase terminates TLS with a chain `pg` won't verify out of the box;
      // the pooler hostname in the connection string is what we trust here.
      ssl: { rejectUnauthorized: false },
    });
    global.omsPoolGlobal.on("error", (err) => {
      console.error("[oms] idle pool client error", err.message);
    });
  }
  return global.omsPoolGlobal;
}

export class OmsNotConfiguredError extends Error {
  constructor() {
    super("OMS_DATABASE_URL is not set - cannot reach the FynkTech OMS database.");
    this.name = "OmsNotConfiguredError";
  }
}

/** Thrown when the staging table hasn't been created yet (see oms:bootstrap). */
export class OmsSchemaMissingError extends Error {
  constructor() {
    super(
      "integrations.shopify_pending_installs does not exist. Apply the OMS " +
        "migration in oms-patch-proposal/, or run `npm run oms:bootstrap`.",
    );
    this.name = "OmsSchemaMissingError";
  }
}

export function isOmsConfigured() {
  return Boolean(process.env.OMS_DATABASE_URL);
}

async function query(text, params) {
  const pool = getPool();
  if (!pool) throw new OmsNotConfiguredError();
  try {
    return await pool.query(text, params);
  } catch (err) {
    // 42P01 undefined_table, 3F000 invalid_schema_name
    if (err?.code === "42P01" || err?.code === "3F000") throw new OmsSchemaMissingError();
    throw err;
  }
}

/**
 * Resolve which OMS organization an email belongs to.
 *
 * Emails live in Supabase's `auth.users`, never in a Django table - org
 * membership is `core.memberships.user_id -> auth.users.id`. A user belonging
 * to two active orgs is deliberately treated as NO match: guessing would put
 * one merchant's Admin token on another tenant's dashboard.
 *
 * @returns {Promise<{organizationId: string, organizationName: string} | null>}
 */
export async function findOrganizationByEmail(email) {
  const normalized = (email || "").trim().toLowerCase();
  if (!normalized) return null;

  const { rows } = await query(
    `select distinct m.organization_id, o.name
       from auth.users u
       join core.memberships m on m.user_id = u.id
       join core.organizations o on o.id = m.organization_id
      where lower(u.email) = $1
        and o.is_active = true`,
    [normalized],
  );

  if (rows.length !== 1) return null;
  return { organizationId: rows[0].organization_id, organizationName: rows[0].name };
}

/**
 * Upsert the credentials captured at install time.
 *
 * Re-running this (a reinstall, a scope upgrade, a token refresh) overwrites
 * the token but deliberately keeps any organization_id already resolved or
 * claimed - re-matching on every auth would let a staff change silently move
 * a live store to a different tenant.
 */
export async function savePendingInstall({
  shopDomain,
  shopName = "",
  currency = "",
  accessToken,
  webhookSecret,
  scopes = "",
  apiVersion = "",
  installedByEmail = "",
  organizationId = null,
  matchMethod = "unassigned",
}) {
  const { rows } = await query(
    `insert into integrations.shopify_pending_installs
       (shop_domain, shop_name, currency, access_token, webhook_secret,
        scopes, api_version, installed_by_email, organization_id,
        match_method, status, claim_code)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending',
             upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8)))
     on conflict (shop_domain) do update set
       shop_name          = excluded.shop_name,
       currency           = excluded.currency,
       access_token       = excluded.access_token,
       webhook_secret     = excluded.webhook_secret,
       scopes             = excluded.scopes,
       api_version        = excluded.api_version,
       installed_by_email = excluded.installed_by_email,
       organization_id    = coalesce(
                              integrations.shopify_pending_installs.organization_id,
                              excluded.organization_id),
       match_method       = case
                              when integrations.shopify_pending_installs.organization_id is not null
                                then integrations.shopify_pending_installs.match_method
                              else excluded.match_method
                            end,
       status             = 'pending',
       uninstalled_at     = null,
       updated_at         = now()
     returning *`,
    [
      shopDomain,
      shopName,
      currency,
      accessToken,
      webhookSecret,
      scopes,
      apiVersion,
      installedByEmail,
      organizationId,
      matchMethod,
    ],
  );
  return rows[0];
}

export async function getPendingInstall(shopDomain) {
  const { rows } = await query(
    `select p.*, o.name as organization_name
       from integrations.shopify_pending_installs p
       left join core.organizations o on o.id = p.organization_id
      where p.shop_domain = $1`,
    [shopDomain],
  );
  return rows[0] ?? null;
}

/**
 * Bind an unassigned install to the org that owns `email`.
 *
 * Only ever moves NULL -> an org. An install already bound to a tenant is
 * never reassigned here; that would be a cross-tenant credential move and
 * belongs to a super admin, not to whoever happens to open the embedded app.
 */
export async function claimPendingInstall({ shopDomain, email }) {
  const match = await findOrganizationByEmail(email);
  if (!match) return { ok: false, reason: "no_match" };

  const { rows } = await query(
    `update integrations.shopify_pending_installs
        set organization_id = $2,
            match_method    = 'claimed',
            updated_at      = now()
      where shop_domain = $1
        and organization_id is null
      returning *`,
    [shopDomain, match.organizationId],
  );
  if (!rows.length) return { ok: false, reason: "already_linked" };
  return { ok: true, row: rows[0], organization: match };
}

export async function updateStoredScopes(shopDomain, scopes) {
  await query(
    `update integrations.shopify_pending_installs
        set scopes = $2, updated_at = now()
      where shop_domain = $1`,
    [shopDomain, scopes],
  );
}

/**
 * On uninstall the token Shopify handed us is already dead. Blank it rather
 * than keep a useless secret at rest, and leave the row so the OMS can show
 * "this store uninstalled the app" instead of the connection silently rotting.
 */
export async function markUninstalled(shopDomain) {
  await query(
    `update integrations.shopify_pending_installs
        set status = 'uninstalled',
            access_token = '',
            uninstalled_at = now(),
            updated_at = now()
      where shop_domain = $1`,
    [shopDomain],
  );
}

/** shop/redact: Shopify requires the store's data to be gone within 48h. */
export async function purgeShop(shopDomain) {
  await query(
    `delete from integrations.shopify_pending_installs where shop_domain = $1`,
    [shopDomain],
  );
}
