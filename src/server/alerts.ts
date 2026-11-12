import "server-only";
import { one, q } from "./db";
import { env } from "./env";
import { sendMail } from "./mailer";
import { getSetting } from "./seed";
import { log } from "./audit";

/**
 * Operator alerts: recorded in alert_log and emailed to ADMIN_EMAILS, at most once per `kind` per cooldown
 * (setting alert_cooldown_minutes). Never throws: alerting must not break the request that triggered it.
 */
export async function raiseAlert(kind: string, subject: string, body: string): Promise<"sent" | "throttled" | "logged"> {
  try {
    const cooldown = Number(await getSetting<number>("alert_cooldown_minutes").catch(() => 60)) || 60;
    const recent = await one(`SELECT 1 FROM alert_log WHERE kind=$1 AND emailed AND created_at > now() - ($2 || ' minutes')::interval LIMIT 1`, [kind, String(cooldown)]);
    const admins = env().ADMIN_EMAILS.split(",").map((x) => x.trim()).filter(Boolean);
    const willEmail = !recent && admins.length > 0;
    await q(`INSERT INTO alert_log (kind, subject, body, emailed) VALUES ($1,$2,$3,$4)`, [kind, subject.slice(0, 200), body.slice(0, 4000), willEmail]);
    log("warn", "alert", { kind, subject });
    if (!willEmail) return recent ? "throttled" : "logged";
    const url = `${env().APP_URL}/admin/status`;
    for (const to of admins) {
      await sendMail({ to, subject: `[${env().APP_NAME}] ${subject}`, text: `${body}\n\nStatus page: ${url}\n\nYou receive this because your email is in ADMIN_EMAILS. Repeats of this alert are muted for ${cooldown} minutes.` });
    }
    return "sent";
  } catch (e) {
    log("error", "alert.failed", { kind, error: (e as Error).message });
    return "logged";
  }
}

/** Worker liveness, shown on the status page. */
export async function workerHeartbeat(workerId: string, info: Record<string, unknown>) {
  await q(
    `INSERT INTO worker_heartbeats (worker_id, info, last_seen) VALUES ($1,$2,now())
     ON CONFLICT (worker_id) DO UPDATE SET info=EXCLUDED.info, last_seen=now()`,
    [workerId, JSON.stringify(info)],
  );
  await q(`DELETE FROM worker_heartbeats WHERE last_seen < now() - interval '1 day'`);
}

/** Periodic checks run by the worker's maintenance loop. */
export async function runHealthChecks() {
  const r = await one<{ total: number; failed: number }>(
    `SELECT count(*)::int AS total, count(*) FILTER (WHERE status='failed')::int AS failed
       FROM generation_jobs WHERE finished_at > now() - interval '30 minutes'`,
  );
  if (r && r.total >= 4 && r.failed / r.total >= 0.5) {
    await raiseAlert("failure_rate", "Many generations are failing", `${r.failed} of ${r.total} generations failed in the last 30 minutes. Check the engine keys and credit balances (OpenAI / Google) and the worker logs.`);
  }
  const stuck = await one<{ n: number }>(`SELECT count(*)::int AS n FROM generation_jobs WHERE status='queued' AND run_after < now() - interval '10 minutes'`);
  if (stuck && stuck.n > 0) {
    await raiseAlert("queue_backlog", "Generations are waiting in the queue", `${stuck.n} job(s) have been waiting more than 10 minutes. Is the worker service running and does it have enough capacity?`);
  }
}
