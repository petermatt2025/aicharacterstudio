import "server-only";
import type pg from "pg";
import { one, pool, q } from "./db";
import { AppError } from "./errors";

/**
 * Credit model
 * - credit_grants are buckets (trial, subscription period, annual monthly allocation, top-up, admin).
 * - Reservation immediately deducts from buckets (included/trial first, purchased last, soonest expiry first)
 *   and records per-bucket allocations, so expiry and refunds stay exact.
 * - Settlement charges only delivered outputs; the remainder returns to the buckets it came from.
 * - credit_wallets.balance = sum(remaining) of live buckets; it is a locked cache, and the ledger records every move.
 * - Every mutation runs inside the caller's transaction after locking the wallet row (SELECT ... FOR UPDATE).
 */

export type GrantSource = "trial" | "subscription" | "annual_allocation" | "topup" | "admin";

type Wallet = { workspace_id: string; balance: number; reserved: number };

export async function ensureWallet(c: pg.PoolClient, workspaceId: string) {
  await c.query(`INSERT INTO credit_wallets (workspace_id) VALUES ($1) ON CONFLICT DO NOTHING`, [workspaceId]);
}

async function lockWallet(c: pg.PoolClient, workspaceId: string): Promise<Wallet> {
  await ensureWallet(c, workspaceId);
  const w = await one<Wallet>(`SELECT workspace_id, balance, reserved FROM credit_wallets WHERE workspace_id=$1 FOR UPDATE`, [workspaceId], c);
  if (!w) throw new AppError("not_found", "Wallet not found");
  return w;
}

async function writeLedger(
  c: pg.PoolClient,
  e: { workspaceId: string; type: string; amount: number; balanceAfter: number; grantId?: string | null; jobId?: string | null; description: string; idempotencyKey?: string | null },
) {
  await c.query(
    `INSERT INTO credit_ledger (workspace_id, entry_type, amount, balance_after, grant_id, job_id, description, idempotency_key)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [e.workspaceId, e.type, e.amount, e.balanceAfter, e.grantId ?? null, e.jobId ?? null, e.description, e.idempotencyKey ?? null],
  );
}

async function setBalance(c: pg.PoolClient, workspaceId: string, balance: number, reserved: number) {
  if (balance < 0 || reserved < 0) throw new Error(`Credit invariant violated for ${workspaceId}: balance=${balance} reserved=${reserved}`);
  await c.query(`UPDATE credit_wallets SET balance=$2, reserved=$3, updated_at=now() WHERE workspace_id=$1`, [workspaceId, balance, reserved]);
}

/** Expire/revoke leftover credits in dead buckets. Call with the wallet locked. */
async function sweep(c: pg.PoolClient, w: Wallet): Promise<Wallet> {
  const dead = await q<{ id: string; remaining: number; kind: "expire" | "revoke" }>(
    `SELECT id, remaining, CASE WHEN revoked_at IS NOT NULL THEN 'revoke' ELSE 'expire' END AS kind
       FROM credit_grants
      WHERE workspace_id=$1 AND remaining > 0 AND (revoked_at IS NOT NULL OR (expires_at IS NOT NULL AND expires_at <= now()))
      FOR UPDATE`,
    [w.workspace_id],
    c,
  );
  let balance = w.balance;
  for (const g of dead) {
    balance -= g.remaining;
    await c.query(`UPDATE credit_grants SET remaining=0, expired_at = CASE WHEN revoked_at IS NULL THEN now() ELSE expired_at END WHERE id=$1`, [g.id]);
    await writeLedger(c, { workspaceId: w.workspace_id, type: g.kind, amount: -g.remaining, balanceAfter: balance, grantId: g.id, description: g.kind === "expire" ? "Credits expired" : "Credits revoked" });
  }
  if (dead.length) await setBalance(c, w.workspace_id, balance, w.reserved);
  return { ...w, balance };
}

export async function grantCredits(
  c: pg.PoolClient,
  g: { workspaceId: string; source: GrantSource; sourceRef: string; amount: number; expiresAt: Date | null; description: string },
): Promise<{ created: boolean; grantId: string }> {
  if (!Number.isInteger(g.amount) || g.amount <= 0) throw new AppError("validation_failed", "Grant amount must be a positive integer");
  let w = await lockWallet(c, g.workspaceId);
  w = await sweep(c, w); // must run before inserting: the new grant is not in the cached balance yet
  const priority = g.source === "topup" ? 1 : 0;
  const ins = await one<{ id: string }>(
    `INSERT INTO credit_grants (workspace_id, source, source_ref, priority, amount, remaining, expires_at)
     VALUES ($1,$2,$3,$4,$5,$5,$6) ON CONFLICT (source, source_ref) DO NOTHING RETURNING id`,
    [g.workspaceId, g.source, g.sourceRef, priority, g.amount, g.expiresAt],
    c,
  );
  if (!ins) {
    const existing = await one<{ id: string }>(`SELECT id FROM credit_grants WHERE source=$1 AND source_ref=$2`, [g.source, g.sourceRef], c);
    return { created: false, grantId: existing!.id };
  }
  const balance = w.balance + g.amount;
  await setBalance(c, g.workspaceId, balance, w.reserved);
  await writeLedger(c, { workspaceId: g.workspaceId, type: "grant", amount: g.amount, balanceAfter: balance, grantId: ins.id, description: g.description, idempotencyKey: `grant:${g.source}:${g.sourceRef}` });
  // A grant whose expiry is already past is swept immediately (keeps the invariant honest).
  await sweep(c, { ...w, balance });
  return { created: true, grantId: ins.id };
}

/** Reserve credits for a job. Throws insufficient_credits without side effects when the balance is too low. */
export async function reserveCredits(c: pg.PoolClient, workspaceId: string, jobId: string, amount: number) {
  if (!Number.isInteger(amount) || amount <= 0) throw new AppError("validation_failed", "Reservation must be a positive integer");
  let w = await lockWallet(c, workspaceId);
  w = await sweep(c, w);
  if (w.balance < amount) {
    throw new AppError("insufficient_credits", `This needs ${amount} credits; you have ${w.balance}.`, { required: amount, available: w.balance });
  }
  const grants = await q<{ id: string; remaining: number }>(
    `SELECT id, remaining FROM credit_grants
      WHERE workspace_id=$1 AND remaining > 0 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      ORDER BY priority ASC, expires_at ASC NULLS LAST, created_at ASC FOR UPDATE`,
    [workspaceId],
    c,
  );
  const res = await one<{ id: string }>(`INSERT INTO credit_reservations (workspace_id, job_id, amount, status) VALUES ($1,$2,$3,'held') RETURNING id`, [workspaceId, jobId, amount], c);
  let left = amount;
  for (const g of grants) {
    if (left === 0) break;
    const take = Math.min(left, g.remaining);
    await c.query(`UPDATE credit_grants SET remaining = remaining - $2 WHERE id=$1`, [g.id, take]);
    await c.query(`INSERT INTO credit_reservation_allocations (reservation_id, grant_id, amount) VALUES ($1,$2,$3)`, [res!.id, g.id, take]);
    left -= take;
  }
  if (left !== 0) throw new Error("Credit allocation mismatch (wallet cache out of sync with grants)");
  const balance = w.balance - amount;
  await setBalance(c, workspaceId, balance, w.reserved + amount);
  await writeLedger(c, { workspaceId, type: "reserve", amount: -amount, balanceAfter: balance, jobId, description: `Reserved ${amount} credits` });
}

/**
 * Close a reservation: charge `charge` credits (clamped to the reserved amount) and return the rest.
 * Idempotent: a closed reservation is left untouched.
 */
export async function settleReservation(c: pg.PoolClient, jobId: string, charge: number): Promise<{ charged: number; released: number; alreadyClosed: boolean }> {
  const r = await one<{ id: string; workspace_id: string; amount: number; status: string; charged: number }>(
    `SELECT id, workspace_id, amount, status, charged FROM credit_reservations WHERE job_id=$1`,
    [jobId],
    c,
  );
  if (!r) throw new AppError("not_found", "Reservation not found");
  let w = await lockWallet(c, r.workspace_id); // lock order: wallet, then reservation
  const locked = await one<{ status: string }>(`SELECT status FROM credit_reservations WHERE id=$1 FOR UPDATE`, [r.id], c);
  if (locked!.status !== "held") return { charged: r.charged, released: 0, alreadyClosed: true };

  const charged = Math.max(0, Math.min(Math.floor(charge), r.amount));
  const release = r.amount - charged;
  // Charge is consumed in allocation order; refunds go back to the last-allocated buckets first.
  const allocs = await q<{ grant_id: string; amount: number }>(
    `SELECT a.grant_id, a.amount FROM credit_reservation_allocations a JOIN credit_grants g ON g.id=a.grant_id
      WHERE a.reservation_id=$1 ORDER BY g.priority DESC, g.expires_at DESC NULLS FIRST, g.created_at DESC`,
    [r.id],
    c,
  );
  let toReturn = release;
  for (const a of allocs) {
    if (toReturn === 0) break;
    const back = Math.min(toReturn, a.amount);
    await c.query(`UPDATE credit_grants SET remaining = remaining + $2 WHERE id=$1`, [a.grant_id, back]);
    toReturn -= back;
  }
  await c.query(`UPDATE credit_reservations SET status=$2, charged=$3, closed_at=now() WHERE id=$1`, [r.id, charged > 0 ? "settled" : "released", charged]);
  const balance = w.balance + release;
  w = { ...w, balance, reserved: w.reserved - r.amount };
  await setBalance(c, r.workspace_id, w.balance, w.reserved);
  if (charged > 0) await writeLedger(c, { workspaceId: r.workspace_id, type: "settle", amount: 0, balanceAfter: balance, jobId, description: `Charged ${charged} credits for delivered outputs` });
  if (release > 0) await writeLedger(c, { workspaceId: r.workspace_id, type: "release", amount: release, balanceAfter: balance, jobId, description: `Returned ${release} unused credits` });
  await sweep(c, w); // returned credits that landed in an expired/revoked bucket are swept honestly
  return { charged, released: release, alreadyClosed: false };
}

/** Revoke up to `credits` of unspent credits from a grant (refunds/chargebacks). Never creates a negative balance. */
export async function revokeGrantCredits(c: pg.PoolClient, source: GrantSource, sourceRef: string, credits: number | "all", reason: string) {
  const g = await one<{ id: string; workspace_id: string; remaining: number; amount: number }>(
    `SELECT id, workspace_id, remaining, amount FROM credit_grants WHERE source=$1 AND source_ref=$2`,
    [source, sourceRef],
    c,
  );
  if (!g) return { revoked: 0 };
  const w = await lockWallet(c, g.workspace_id);
  const cur = await one<{ remaining: number }>(`SELECT remaining FROM credit_grants WHERE id=$1 FOR UPDATE`, [g.id], c);
  const take = Math.min(cur!.remaining, credits === "all" ? cur!.remaining : Math.max(0, Math.floor(credits)));
  if (credits === "all") await c.query(`UPDATE credit_grants SET revoked_at=now() WHERE id=$1`, [g.id]);
  if (take > 0) {
    await c.query(`UPDATE credit_grants SET remaining = remaining - $2 WHERE id=$1`, [g.id, take]);
    const balance = w.balance - take;
    await setBalance(c, g.workspace_id, balance, w.reserved);
    await writeLedger(c, { workspaceId: g.workspace_id, type: "revoke", amount: -take, balanceAfter: balance, grantId: g.id, description: reason });
  }
  return { revoked: take };
}

/** Expire subscription credits from previous periods when a new period starts (no silent rollover). */
export async function expireSubscriptionGrantsBefore(c: pg.PoolClient, workspaceId: string, keepGrantId: string) {
  await lockWallet(c, workspaceId);
  await c.query(
    `UPDATE credit_grants SET expires_at = now() WHERE workspace_id=$1 AND source IN ('subscription','annual_allocation') AND id <> $2 AND remaining > 0 AND (expires_at IS NULL OR expires_at > now())`,
    [workspaceId, keepGrantId],
  );
  const w = await lockWallet(c, workspaceId);
  await sweep(c, w);
}

export async function sweepAllExpired() {
  const ws = await q<{ workspace_id: string }>(
    `SELECT DISTINCT workspace_id FROM credit_grants WHERE remaining > 0 AND (revoked_at IS NOT NULL OR expires_at <= now())`,
  );
  for (const { workspace_id } of ws) {
    const c = await pool().connect();
    try {
      await c.query("BEGIN");
      const w = await lockWallet(c, workspace_id);
      await sweep(c, w);
      await c.query("COMMIT");
    } catch (e) {
      await c.query("ROLLBACK");
      throw e;
    } finally {
      c.release();
    }
  }
  return ws.length;
}

export async function getBalance(workspaceId: string) {
  const w = await one<{ balance: number; reserved: number }>(`SELECT balance, reserved FROM credit_wallets WHERE workspace_id=$1`, [workspaceId]);
  const next = await one<{ amount: number; expires_at: Date }>(
    `SELECT sum(remaining)::int AS amount, min(expires_at) AS expires_at FROM credit_grants
      WHERE workspace_id=$1 AND remaining>0 AND revoked_at IS NULL AND expires_at IS NOT NULL AND expires_at > now()
        AND expires_at = (SELECT min(expires_at) FROM credit_grants WHERE workspace_id=$1 AND remaining>0 AND revoked_at IS NULL AND expires_at > now())`,
    [workspaceId],
  );
  return { balance: w?.balance ?? 0, reserved: w?.reserved ?? 0, nextExpiry: next?.expires_at ? { amount: next.amount, at: next.expires_at } : null };
}

/** Test/admin invariant check: cached wallet equals the ledger-derived buckets. */
export async function checkInvariants(workspaceId: string) {
  const r = await one<{ balance: number; reserved: number; live: number; held: number; ledger_sum: number }>(
    `SELECT w.balance, w.reserved,
       COALESCE((SELECT sum(remaining) FROM credit_grants g WHERE g.workspace_id=w.workspace_id AND g.revoked_at IS NULL AND (g.expires_at IS NULL OR g.expires_at > now())),0)::int AS live,
       COALESCE((SELECT sum(amount) FROM credit_reservations r WHERE r.workspace_id=w.workspace_id AND r.status='held'),0)::int AS held,
       COALESCE((SELECT sum(amount) FROM credit_ledger l WHERE l.workspace_id=w.workspace_id),0)::int AS ledger_sum
     FROM credit_wallets w WHERE w.workspace_id=$1`,
    [workspaceId],
  );
  return r;
}
