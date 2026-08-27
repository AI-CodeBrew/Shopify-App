/**
 * Pre-flight check for the OMS link. Run before a deploy, and first whenever an
 * install "worked" but nothing showed up in the OMS:  npm run oms:doctor
 *
 * Every check is read-only.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const results = [];
const record = (ok, label, detail = "") => results.push({ ok, label, detail });

// --- env ------------------------------------------------------------------
for (const key of ["SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "SHOPIFY_APP_URL", "SCOPES"]) {
  record(Boolean(process.env[key]), `env ${key}`, process.env[key] ? "" : "missing");
}
record(
  Boolean(process.env.OMS_DATABASE_URL),
  "env OMS_DATABASE_URL",
  process.env.OMS_DATABASE_URL ? "" : "missing - installs will not be staged",
);

// --- scopes in .env match shopify.app.toml --------------------------------
// Managed installation makes the TOML authoritative once deployed, but local
// `shopify app dev` uses SCOPES. A drift between the two means the token you
// capture in dev has different permissions than the one merchants grant.
try {
  const toml = readFileSync(resolve(here, "../shopify.app.toml"), "utf8");
  const block = toml.match(/scopes\s*=\s*"""([\s\S]*?)"""/);
  const tomlScopes = new Set(
    (block?.[1] ?? "").split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
  );
  const envScopes = new Set(
    (process.env.SCOPES ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  );
  const onlyToml = [...tomlScopes].filter((s) => !envScopes.has(s));
  const onlyEnv = [...envScopes].filter((s) => !tomlScopes.has(s));
  record(
    onlyToml.length === 0 && onlyEnv.length === 0,
    `scopes in sync (${tomlScopes.size} in toml)`,
    [
      onlyToml.length ? `only in toml: ${onlyToml.join(", ")}` : "",
      onlyEnv.length ? `only in .env: ${onlyEnv.join(", ")}` : "",
    ]
      .filter(Boolean)
      .join(" | "),
  );
} catch (err) {
  record(false, "scopes in sync", err.message);
}

// --- database -------------------------------------------------------------
if (process.env.OMS_DATABASE_URL) {
  const client = new pg.Client({
    connectionString: process.env.OMS_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    record(true, "connect to OMS database");

    const { rows } = await client.query(
      `select to_regclass('core.organizations')                      as orgs,
              to_regclass('core.memberships')                        as memberships,
              to_regclass('integrations.shopify_pending_installs')    as pending,
              to_regclass('integrations.shopify_connections')         as connections`,
    );
    const r = rows[0];
    record(Boolean(r.orgs), "core.organizations");
    record(Boolean(r.memberships), "core.memberships");
    record(Boolean(r.connections), "integrations.shopify_connections");
    record(
      Boolean(r.pending),
      "integrations.shopify_pending_installs",
      r.pending ? "" : "missing - run npm run oms:bootstrap or apply the migration",
    );

    // auth.users is what email matching reads. A permission error here is the
    // usual reason auto-matching silently never fires.
    try {
      await client.query("select 1 from auth.users limit 1");
      record(true, "read auth.users (email matching)");
    } catch (err) {
      record(false, "read auth.users (email matching)", err.message);
    }

    if (r.pending) {
      const { rows: counts } = await client.query(
        `select status,
                count(*)                                           as total,
                count(*) filter (where organization_id is null)    as unassigned
           from integrations.shopify_pending_installs
          group by status`,
      );
      for (const c of counts) {
        record(true, `staged installs: ${c.status}`, `${c.total} (${c.unassigned} unassigned)`);
      }
    }
  } catch (err) {
    record(false, "connect to OMS database", err.message);
  } finally {
    await client.end().catch(() => {});
  }
}

// --- report ---------------------------------------------------------------
let failed = 0;
for (const { ok, label, detail } of results) {
  if (!ok) failed += 1;
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}${detail ? ` — ${detail}` : ""}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exitCode = failed ? 1 : 0;
