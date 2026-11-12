import pg from "pg";

/** Recreate the test schema from migrations, then seed the catalog. */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgres://postgres@localhost:5432/acs_test";
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  await c.query("DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;");
  await c.end();
  process.env.DATABASE_URL = url;
  (process.env as Record<string, string>).NODE_ENV = "test";
  const { runMigrations } = await import("../src/server/migrate");
  const { seedCatalog } = await import("../src/server/seed");
  const { closePool } = await import("../src/server/db");
  await runMigrations();
  await seedCatalog();
  // Most tests check plan gating; trial-specific tests opt into the free trial tools themselves.
  const { q } = await import("../src/server/db");
  await q(`UPDATE app_settings SET value='[]' WHERE key='trial_features'`);
  await closePool();
}
