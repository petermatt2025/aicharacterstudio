import fs from "node:fs";
import path from "node:path";
import { pool } from "./db";

const DIR = path.join(process.cwd(), "db", "migrations");

/** Applies pending SQL migrations in filename order, each in its own transaction, under an advisory lock. */
export async function runMigrations(): Promise<string[]> {
  const c = await pool().connect();
  const applied: string[] = [];
  try {
    await c.query("SELECT pg_advisory_lock(727001)");
    await c.query(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const done = new Set((await c.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name));
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = fs.readFileSync(path.join(DIR, f), "utf8");
      await c.query("BEGIN");
      try {
        await c.query(sql);
        await c.query("INSERT INTO schema_migrations(name) VALUES ($1)", [f]);
        await c.query("COMMIT");
        applied.push(f);
      } catch (e) {
        await c.query("ROLLBACK");
        throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
      }
    }
  } finally {
    await c.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    c.release();
  }
  return applied;
}
