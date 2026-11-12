import "server-only";
import type { SessionUser } from "./accounts";
import { one, q, tx } from "./db";
import { AppError } from "./errors";
import { randomToken } from "./crypto";
import { verifyPassword, hashPassword } from "./crypto";
import { settleReservation } from "./credits";
import { billingConfigured, cancelSubscriptionsForWorkspace } from "./billing";
import { storage } from "./storage";
import { audit, log } from "./audit";

/**
 * Account deletion (GDPR erasure):
 * 1. cancel Stripe subscriptions (abort if that fails, so the customer is never billed for a deleted account),
 * 2. cancel queued jobs (credits returned) and stop running ones,
 * 3. delete every stored image object and soft-delete asset rows,
 * 4. anonymize the user row and drop sessions/tokens.
 * Retained: ledger/payment/audit rows needed for accounting (no image data, no email), and a hashed trial claim.
 */
export async function deleteAccount(user: SessionUser, password: string, reason?: string) {
  const u = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id=$1`, [user.id]);
  if (!u || !(await verifyPassword(password, u.password_hash))) throw new AppError("invalid_credentials", "Password is incorrect.");
  const req = await one<{ id: string }>(`INSERT INTO account_deletion_requests (user_id, status, reason) VALUES ($1,'requested',$2) RETURNING id`, [user.id, reason?.slice(0, 500) ?? null]);
  const owned = await q<{ id: string }>(`SELECT id FROM workspaces WHERE owner_user_id=$1 AND deleted_at IS NULL`, [user.id]);
  try {
    for (const w of owned) {
      const hasSub = await one(`SELECT 1 FROM subscriptions WHERE workspace_id=$1 AND status NOT IN ('canceled','incomplete_expired')`, [w.id]);
      if (hasSub) {
        if (!billingConfigured()) throw new AppError("billing_not_configured", "Cannot cancel your subscription right now. Please contact support.");
        await cancelSubscriptionsForWorkspace(w.id);
      }
    }
    const keys: string[] = [];
    await tx(async (c) => {
      for (const w of owned) {
        const queued = await q<{ id: string }>(`SELECT id FROM generation_jobs WHERE workspace_id=$1 AND status='queued' FOR UPDATE`, [w.id], c);
        for (const j of queued) {
          await settleReservation(c, j.id, 0);
          await c.query(`UPDATE generation_jobs SET status='canceled', finished_at=now(), error_code='account_deleted' WHERE id=$1`, [j.id]);
        }
        await c.query(`UPDATE generation_jobs SET cancel_requested=true WHERE workspace_id=$1 AND status='running'`, [w.id]);
        const assets = await q<{ storage_key: string; thumb_key: string | null }>(`UPDATE assets SET deleted_at=now() WHERE workspace_id=$1 AND deleted_at IS NULL RETURNING storage_key, thumb_key`, [w.id], c);
        for (const a of assets) keys.push(a.storage_key, ...(a.thumb_key ? [a.thumb_key] : []));
        await c.query(`UPDATE character_profiles SET deleted_at=now(), name='deleted', notes='' WHERE workspace_id=$1`, [w.id]);
        await c.query(`UPDATE style_boards SET deleted_at=now(), name='deleted', description='' WHERE workspace_id=$1`, [w.id]);
        await c.query(`UPDATE workspaces SET deleted_at=now(), name='deleted', plan_key='free' WHERE id=$1`, [w.id]);
      }
      await c.query(`DELETE FROM sessions WHERE user_id=$1`, [user.id]);
      await c.query(`DELETE FROM email_tokens WHERE user_id=$1`, [user.id]);
      await c.query(`UPDATE consent_receipts SET user_id=NULL WHERE user_id=$1`, [user.id]);
      await c.query(
        `UPDATE users SET status='deleted', email=$2, email_canonical=$2, display_name='', password_hash=$3, is_admin=false, deleted_at=now(), updated_at=now() WHERE id=$1`,
        [user.id, `deleted+${user.id}@deleted.invalid`, await hashPassword(randomToken())],
      );
    });
    // Objects outside the transaction; failures are logged for the cleanup job rather than blocking erasure of the account record.
    for (const k of keys) await storage().delete(k).catch((e) => log("error", "deletion.object_failed", { key: k, error: (e as Error).message }));
    await q(`UPDATE account_deletion_requests SET status='completed', completed_at=now() WHERE id=$1`, [req!.id]);
    await audit(user.id, "account.deleted", `user:${user.id}`, { objects: keys.length });
    return { deleted: true, objectsRemoved: keys.length };
  } catch (e) {
    await q(`UPDATE account_deletion_requests SET status='failed', error=$2 WHERE id=$1`, [req!.id, (e as Error).message.slice(0, 300)]);
    throw e;
  }
}
