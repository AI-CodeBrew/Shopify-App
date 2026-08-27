/**
 * Creates integrations.shopify_pending_installs in the OMS database.
 *
 * The OMS owns its own schema through Django migrations, so the real home for
 * this table is oms-patch-proposal/backend/integrations/migrations/. This
 * script exists for the case where you want the Shopify app working against a
 * dev/staging database before wiring the migration into the OMS repo.
 *
 * Guarded behind OMS_ALLOW_BOOTSTRAP=1 so it can never fire by accident from a
 * deploy hook. Run:  npm run oms:bootstrap
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const here = dirname(fileURLToPath(import.meta.url));
const SQL_PATH = resolve(here, "../../oms-patch-proposal/0010_shopify_pending_installs.sql");

if (process.env.OMS_ALLOW_BOOTSTRAP !== "1") {
  console.error(
    "Refusing to run: set OMS_ALLOW_BOOTSTRAP=1 in .env first.\n" +
      "This writes DDL to the OMS production database if OMS_DATABASE_URL points there.",
  );
  process.exit(1);
}

const connectionString = process.env.OMS_DATABASE_URL;
if (!connectionString) {
  console.error("OMS_DATABASE_URL is not set.");
  process.exit(1);
}

const sql = readFileSync(SQL_PATH, "utf8");
const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });

try {
  await client.connect();

  // core.organizations is the FK target and core.is_super_admin() backs the RLS
  // policy. If either is missing we are pointed at the wrong database, and
  // running the DDL would half-create a table against an unrelated schema.
  const { rows } = await client.query(
    `select to_regclass('core.organizations') as org_table,
            to_regprocedure('core.is_super_admin()') as is_super_admin`,
  );
  if (!rows[0].org_table || !rows[0].is_super_admin) {
    throw new Error(
      "This database does not look like the FynkTech OMS " +
        "(core.organizations / core.is_super_admin() not found). Check OMS_DATABASE_URL.",
    );
  }

  await client.query("begin");
  await client.query(sql);
  await client.query("commit");
  console.log("integrations.shopify_pending_installs is ready.");
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("Bootstrap failed:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
