import "server-only";
import pg from "pg";
import { env } from "./env";

// int8 / numeric as JS numbers where safe (our counters are small); numeric stays string unless parsed.
pg.types.setTypeParser(20, (v) => Number(v));

export type Db = pg.Pool | pg.PoolClient;

const globalForPool = globalThis as unknown as { __acsPool?: pg.Pool };

export function pool(): pg.Pool {
  if (!globalForPool.__acsPool) {
    globalForPool.__acsPool = new pg.Pool({ connectionString: env().DATABASE_URL, max: 10 });
  }
  return globalForPool.__acsPool;
}

export async function closePool() {
  if (globalForPool.__acsPool) {
    await globalForPool.__acsPool.end();
    globalForPool.__acsPool = undefined;
  }
}

export async function q<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T[]> {
  const r = await db.query<T>(sql, params as unknown[]);
  return r.rows;
}

export async function one<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool()): Promise<T | null> {
  const rows = await q<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Run fn inside a transaction. Retries on serialization failures / deadlocks. */
export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await pool().connect();
    try {
      await c.query("BEGIN");
      const out = await fn(c);
      await c.query("COMMIT");
      return out;
    } catch (e) {
      await c.query("ROLLBACK").catch(() => {});
      const code = (e as { code?: string }).code;
      if ((code === "40001" || code === "40P01") && attempt < retries) continue;
      throw e;
    } finally {
      c.release();
    }
  }
}
