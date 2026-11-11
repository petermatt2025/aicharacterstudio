import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { tx, q, one } from "@/server/db";
import { checkInvariants, grantCredits, reserveCredits, revokeGrantCredits, settleReservation, sweepAllExpired } from "@/server/credits";
import { makeUser, uid } from "./helpers";

async function fakeJob(workspaceId: string, userId: string) {
  // Minimal job row so reservations have a valid FK.
  const quote = await one<{ id: string }>(
    `INSERT INTO credit_quotes (workspace_id, user_id, feature_key, request, credits, outputs, plan_key, model, breakdown, expires_at)
     VALUES ($1,$2,'character_angles','{}',1,1,'pro','fake','{}', now() + interval '10 minutes') RETURNING id`,
    [workspaceId, userId],
  );
  const id = crypto.randomUUID();
  await q(
    `INSERT INTO generation_jobs (id, workspace_id, user_id, feature_key, quote_id, idempotency_key, status, request, outputs_requested, credits_reserved)
     VALUES ($1,$2,$3,'character_angles',$4,$5,'queued','{}',4,1)`,
    [id, workspaceId, userId, quote!.id, uid()],
  );
  return id;
}

async function expectInvariant(ws: string) {
  const r = await checkInvariants(ws);
  expect(r!.balance).toBe(r!.live);
  expect(r!.reserved).toBe(r!.held);
  expect(r!.ledger_sum).toBe(r!.balance); // signed ledger sums to spendable balance
}

describe("credit ledger", () => {
  it("grants are idempotent per (source, source_ref)", async () => {
    const u = await makeUser();
    const before = (await checkInvariants(u.workspaceId))!.balance;
    const g = { workspaceId: u.workspaceId, source: "topup" as const, sourceRef: `pi_${uid()}`, amount: 100, expiresAt: null, description: "t" };
    expect((await tx((c) => grantCredits(c, g))).created).toBe(true);
    expect((await tx((c) => grantCredits(c, g))).created).toBe(false);
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(before + 100);
    await expectInvariant(u.workspaceId);
  });

  it("reserves from included/trial credits before purchased, and soonest expiry first", async () => {
    const u = await makeUser({ verified: false });
    const soon = new Date(Date.now() + 86400_000);
    const later = new Date(Date.now() + 10 * 86400_000);
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "topup", sourceRef: `pi_${uid()}`, amount: 50, expiresAt: later, description: "topup" }));
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "subscription", sourceRef: `in_${uid()}`, amount: 10, expiresAt: later, description: "sub" }));
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "admin", sourceRef: `a_${uid()}`, amount: 5, expiresAt: soon, description: "admin" }));
    const job = await fakeJob(u.workspaceId, u.id);
    await tx((c) => reserveCredits(c, u.workspaceId, job, 12));
    const grants = await q<{ source: string; remaining: number }>(`SELECT source, remaining FROM credit_grants WHERE workspace_id=$1`, [u.workspaceId]);
    const by = Object.fromEntries(grants.map((g) => [g.source, g.remaining]));
    expect(by).toEqual({ admin: 0, subscription: 3, topup: 50 });
    await expectInvariant(u.workspaceId);
  });

  it("settles partial delivery and returns the rest; settlement is idempotent", async () => {
    const u = await makeUser({ verified: false, credits: 20 });
    const job = await fakeJob(u.workspaceId, u.id);
    await tx((c) => reserveCredits(c, u.workspaceId, job, 10));
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(10);
    const r1 = await tx((c) => settleReservation(c, job, 5));
    expect(r1).toMatchObject({ charged: 5, released: 5, alreadyClosed: false });
    const r2 = await tx((c) => settleReservation(c, job, 10));
    expect(r2.alreadyClosed).toBe(true);
    const w = await checkInvariants(u.workspaceId);
    expect(w!.balance).toBe(15);
    expect(w!.reserved).toBe(0);
    await expectInvariant(u.workspaceId);
  });

  it("rejects reservations above the balance without side effects", async () => {
    const u = await makeUser({ verified: false, credits: 3 });
    const job = await fakeJob(u.workspaceId, u.id);
    await expect(tx((c) => reserveCredits(c, u.workspaceId, job, 4))).rejects.toMatchObject({ code: "insufficient_credits" });
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(3);
    await expectInvariant(u.workspaceId);
  });

  it("concurrent reservations can never overspend the wallet", async () => {
    const u = await makeUser({ verified: false, credits: 10 });
    const jobs = await Promise.all(Array.from({ length: 12 }, () => fakeJob(u.workspaceId, u.id)));
    const results = await Promise.allSettled(jobs.map((j) => tx((c) => reserveCredits(c, u.workspaceId, j, 3))));
    const ok = results.filter((r) => r.status === "fulfilled").length;
    expect(ok).toBe(3); // 3 x 3 = 9 <= 10, a 4th would overspend
    const w = await checkInvariants(u.workspaceId);
    expect(w!.balance).toBe(1);
    expect(w!.reserved).toBe(9);
    await expectInvariant(u.workspaceId);
  });

  it("expires credits at their expiry and records it", async () => {
    const u = await makeUser({ verified: false });
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "subscription", sourceRef: `in_${uid()}`, amount: 7, expiresAt: new Date(Date.now() + 60_000), description: "s" }));
    await q(`UPDATE credit_grants SET expires_at = now() - interval '1 second' WHERE workspace_id=$1`, [u.workspaceId]);
    await sweepAllExpired();
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(0);
    const e = await one<{ n: number }>(`SELECT count(*)::int AS n FROM credit_ledger WHERE workspace_id=$1 AND entry_type='expire'`, [u.workspaceId]);
    expect(e!.n).toBe(1);
    await expectInvariant(u.workspaceId);
  });

  it("credits returned to an expired bucket are expired, not resurrected", async () => {
    const u = await makeUser({ verified: false });
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "subscription", sourceRef: `in_${uid()}`, amount: 10, expiresAt: new Date(Date.now() + 60_000), description: "s" }));
    const job = await fakeJob(u.workspaceId, u.id);
    await tx((c) => reserveCredits(c, u.workspaceId, job, 10));
    await q(`UPDATE credit_grants SET expires_at = now() - interval '1 second' WHERE workspace_id=$1`, [u.workspaceId]);
    await tx((c) => settleReservation(c, job, 0));
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(0);
    await expectInvariant(u.workspaceId);
  });

  it("revocation only removes unspent credits (never negative)", async () => {
    const u = await makeUser({ verified: false });
    const ref = `pi_${uid()}`;
    await tx((c) => grantCredits(c, { workspaceId: u.workspaceId, source: "topup", sourceRef: ref, amount: 10, expiresAt: null, description: "t" }));
    const job = await fakeJob(u.workspaceId, u.id);
    await tx((c) => reserveCredits(c, u.workspaceId, job, 8));
    await tx((c) => settleReservation(c, job, 8));
    const r = await tx((c) => revokeGrantCredits(c, "topup", ref, "all", "refund"));
    expect(r.revoked).toBe(2);
    expect((await checkInvariants(u.workspaceId))!.balance).toBe(0);
    await expectInvariant(u.workspaceId);
  });
});
