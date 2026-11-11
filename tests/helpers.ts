import crypto from "node:crypto";
import sharp from "sharp";
import { signup, verifyEmail, userFromSessionToken, createSession, type SessionUser } from "@/server/accounts";
import { one, q } from "@/server/db";
import { uploadAsset, type UploadKind } from "@/server/assets";
import type { PlanKey } from "@/lib/catalog";
import { tx } from "@/server/db";
import { grantCredits } from "@/server/credits";

export const uid = () => crypto.randomBytes(5).toString("hex");

export async function verificationTokenFor(email: string): Promise<string> {
  const mail = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE to_email=$1 ORDER BY created_at DESC LIMIT 1`, [email]);
  const m = /token=([^\s]+)/.exec(mail!.body_text);
  return decodeURIComponent(m![1]!);
}

export async function makeUser(opts: { plan?: PlanKey; beta?: boolean; admin?: boolean; verified?: boolean; credits?: number; email?: string } = {}): Promise<SessionUser & { token: string }> {
  const email = opts.email ?? `u_${uid()}@example.com`;
  const { id, workspaceId } = await signup({ email, password: "correct horse battery", displayName: "Test", acceptTerms: true });
  if (opts.verified !== false) await verifyEmail(await verificationTokenFor(email));
  if (opts.plan) await q(`UPDATE workspaces SET plan_key=$2 WHERE id=$1`, [workspaceId, opts.plan]);
  await q(`UPDATE users SET beta_allowlisted=$2, is_admin=$3 WHERE id=$1`, [id, opts.beta ?? true, opts.admin ?? false]);
  if (opts.credits) {
    await tx((c) => grantCredits(c, { workspaceId, source: "admin", sourceRef: `test:${uid()}`, amount: opts.credits!, expiresAt: null, description: "test credits" }));
  }
  const { token } = await createSession(id);
  const u = await userFromSessionToken(token);
  return { ...u!, token };
}

export async function refresh(u: SessionUser & { token: string }) {
  return { ...(await userFromSessionToken(u.token))!, token: u.token };
}

export async function pngBytes(w = 256, h = 256, color = "#c86b5a"): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: color } }).png().toBuffer();
}

export async function jpegWithExif(): Promise<Buffer> {
  return sharp({ create: { width: 320, height: 240, channels: 3, background: "#336699" } })
    .withExif({ IFD0: { Copyright: "secret-owner", Artist: "Someone" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "38/1 43/1 0/1" } })
    .jpeg()
    .toBuffer();
}

export async function upload(u: SessionUser, kind: UploadKind = "character") {
  const consent = kind === "character" ? "self" : "owned_product_or_asset";
  return uploadAsset(u, { kind, consent, title: `${kind} ${uid()}` }, await pngBytes(), `${kind}.png`);
}

export async function balanceOf(workspaceId: string) {
  return (await one<{ balance: number; reserved: number }>(`SELECT balance, reserved FROM credit_wallets WHERE workspace_id=$1`, [workspaceId]))!;
}
