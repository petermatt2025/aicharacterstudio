import "server-only";
import { q, type Db, pool } from "./db";

const SECRET_KEYS = /(password|secret|token|apikey|api_key|authorization|cookie|signed_?url)/i;

function redact(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(redact);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEYS.test(k) ? "[redacted]" : redact(x)]));
  }
  return v;
}

export async function audit(actorId: string | null, action: string, target: string, context: Record<string, unknown> = {}, db: Db = pool()) {
  await q(`INSERT INTO admin_audit_events (actor_id, action, target, context) VALUES ($1,$2,$3,$4)`, [actorId, action, target, JSON.stringify(redact(context))], db);
}

export async function track(userId: string | null, name: string, props: Record<string, unknown> = {}) {
  await q(`INSERT INTO analytics_events (user_id, name, props) VALUES ($1,$2,$3)`, [userId, name, JSON.stringify(props)]).catch(() => {});
}

/** Structured log line. Never pass secrets, signed URLs, or image bytes. */
export function log(level: "info" | "warn" | "error", msg: string, ctx: Record<string, unknown> = {}) {
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(redact(ctx) as object) });
  if (level === "error") console.error(line);
  else if (process.env.NODE_ENV !== "test") console.log(line);
}
