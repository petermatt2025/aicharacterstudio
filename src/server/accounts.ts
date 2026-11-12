import "server-only";
import { z } from "zod";
import { one, q, tx } from "./db";
import { env } from "./env";
import { AppError } from "./errors";
import { canonicalEmail, hashPassword, randomToken, sha256, verifyPassword } from "./crypto";
import { sendMail } from "./mailer";
import { ensureWallet, grantCredits } from "./credits";
import { track, audit } from "./audit";
import { getSetting } from "./seed";

export const signupSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  displayName: z.string().trim().max(80).default(""),
  acceptTerms: z.literal(true, { message: "You must accept the terms and acceptable use policy" }),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export type SessionUser = {
  id: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  onboarded: boolean;
  isAdmin: boolean;
  betaAllowlisted: boolean;
  workspaceId: string;
  planKey: "free" | "creator" | "pro" | "agency";
};

/**
 * Private beta gate. Open when an admin switched sign-up open, or when no invite list exists at all
 * (development). Otherwise the email must be in SIGNUP_ALLOWED_EMAILS or the admin-managed invite list.
 */
export async function signupAllowed(email: string): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const envList = env().SIGNUP_ALLOWED_EMAILS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
  const [open, invites] = await Promise.all([
    getSetting<boolean>("signup_open").catch(() => false),
    getSetting<string[]>("signup_invites").catch(() => [] as string[]),
  ]);
  const list = [...envList, ...(Array.isArray(invites) ? invites.map((x) => String(x).toLowerCase()) : [])];
  if (open === true || list.length === 0) return true;
  return list.includes(e);
}

export async function signup(input: z.input<typeof signupSchema>) {
  const data = signupSchema.parse(input);
  if (!(await signupAllowed(data.email))) throw new AppError("forbidden", "Sign-up is invite-only right now. Ask for an invite.");
  const passwordHash = await hashPassword(data.password);
  const user = await tx(async (c) => {
    const exists = await one(`SELECT 1 FROM users WHERE lower(email)=$1 AND status <> 'deleted'`, [data.email], c);
    if (exists) throw new AppError("email_taken", "An account with this email already exists.");
    const u = await one<{ id: string }>(
      `INSERT INTO users (email, email_canonical, password_hash, display_name) VALUES ($1,$2,$3,$4) RETURNING id`,
      [data.email, canonicalEmail(data.email), passwordHash, data.displayName],
      c,
    );
    const ws = await one<{ id: string }>(`INSERT INTO workspaces (owner_user_id, name) VALUES ($1, $2) RETURNING id`, [u!.id, "Personal"], c);
    await c.query(`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'owner')`, [ws!.id, u!.id]);
    await ensureWallet(c, ws!.id);
    return { id: u!.id, workspaceId: ws!.id };
  });
  await sendVerificationEmail(user.id, data.email);
  await track(user.id, "signup");
  return user;
}

/** Dev convenience: with the console mailer outside production, return the verification link so the UI can show it. */
export async function devVerificationUrl(email: string): Promise<string | null> {
  const e = env();
  if (e.EMAIL_TRANSPORT !== "console" || e.APP_ENV === "production" || e.APP_ENV === "staging") return null;
  const m = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE lower(to_email)=lower($1) ORDER BY created_at DESC LIMIT 1`, [email]);
  const token = m && /token=([^\s]+)/.exec(m.body_text)?.[1];
  return token ? `/verify-email?token=${token}` : null;
}

export async function sendVerificationEmail(userId: string, email: string) {
  const token = randomToken();
  await q(`INSERT INTO email_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1,'verify_email',$2, now() + interval '24 hours')`, [userId, sha256(token)]);
  const url = `${env().APP_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await sendMail({
    to: email,
    subject: `Verify your email for ${env().APP_NAME}`,
    text: `Welcome to ${env().APP_NAME}!\n\nConfirm your email to activate your account and receive your trial credits:\n${url}\n\nThis link expires in 24 hours. If you did not sign up, ignore this email.`,
  });
}

/** Marks email verified and grants one-time trial credits (once per canonical email, ever). */
export async function verifyEmail(token: string) {
  return tx(async (c) => {
    const t = await one<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM email_tokens WHERE token_hash=$1 AND purpose='verify_email' AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
      [sha256(token)],
      c,
    );
    if (!t) throw new AppError("validation_failed", "This verification link is invalid or has expired.");
    await c.query(`UPDATE email_tokens SET used_at=now() WHERE id=$1`, [t.id]);
    const u = await one<{ email_canonical: string; email_verified_at: Date | null }>(`SELECT email_canonical, email_verified_at FROM users WHERE id=$1 FOR UPDATE`, [t.user_id], c);
    if (!u) throw new AppError("not_found", "User not found");
    if (!u.email_verified_at) await c.query(`UPDATE users SET email_verified_at=now(), updated_at=now() WHERE id=$1`, [t.user_id]);
    const admins = env().ADMIN_EMAILS.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    const email = await one<{ email: string }>(`SELECT email FROM users WHERE id=$1`, [t.user_id], c);
    if (email && admins.includes(email.email.toLowerCase())) {
      await c.query(`UPDATE users SET is_admin=true, beta_allowlisted=true WHERE id=$1`, [t.user_id]);
      await audit(null, "user.bootstrap_admin", `user:${t.user_id}`, {}, c);
    }
    let trialGranted = 0;
    // Stored as a hash so no plaintext email survives account deletion.
    const claim = await one(`INSERT INTO trial_claims (email_canonical) VALUES ($1) ON CONFLICT DO NOTHING RETURNING 1 AS ok`, [sha256(`trial:${u.email_canonical}`)], c);
    const trial = env().TRIAL_CREDITS;
    if (claim && trial > 0) {
      const ws = await one<{ id: string }>(`SELECT id FROM workspaces WHERE owner_user_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1`, [t.user_id], c);
      const expires = new Date(Date.now() + env().TRIAL_CREDIT_DAYS * 86400_000);
      await grantCredits(c, { workspaceId: ws!.id, source: "trial", sourceRef: `trial:${t.user_id}`, amount: trial, expiresAt: expires, description: "One-time trial credits" });
      trialGranted = trial;
    }
    return { userId: t.user_id, trialGranted };
  });
}

export async function login(input: z.input<typeof loginSchema>) {
  const data = loginSchema.parse(input);
  const u = await one<{ id: string; password_hash: string; status: string }>(`SELECT id, password_hash, status FROM users WHERE lower(email)=$1 AND status <> 'deleted'`, [data.email]);
  // Always run a hash comparison to reduce user-enumeration timing differences.
  const ok = await verifyPassword(data.password, u?.password_hash ?? "scrypt$32768$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!u || !ok) throw new AppError("invalid_credentials", "Email or password is incorrect.");
  if (u.status !== "active") throw new AppError("forbidden", "This account is suspended. Contact support.");
  return createSession(u.id);
}

export async function createSession(userId: string) {
  const token = randomToken();
  await q(`INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1,$2, now() + ($3 || ' days')::interval)`, [userId, sha256(token), String(env().SESSION_TTL_DAYS)]);
  return { token, maxAgeSeconds: env().SESSION_TTL_DAYS * 86400 };
}

export async function destroySession(token: string) {
  await q(`DELETE FROM sessions WHERE token_hash=$1`, [sha256(token)]);
}

export async function userFromSessionToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const r = await one<{
    id: string; email: string; display_name: string; email_verified_at: Date | null; onboarding_completed_at: Date | null;
    is_admin: boolean; beta_allowlisted: boolean; workspace_id: string; plan_key: SessionUser["planKey"]; session_id: string; last_seen_at: Date;
  }>(
    `SELECT u.id, u.email, u.display_name, u.email_verified_at, u.onboarding_completed_at, u.is_admin, u.beta_allowlisted,
            w.id AS workspace_id, w.plan_key, s.id AS session_id, s.last_seen_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.status = 'active'
       JOIN LATERAL (
         SELECT w.id, w.plan_key FROM workspace_members m JOIN workspaces w ON w.id=m.workspace_id AND w.deleted_at IS NULL
          WHERE m.user_id=u.id AND m.status='active' ORDER BY (m.role='owner') DESC, w.created_at ASC LIMIT 1
       ) w ON true
      WHERE s.token_hash=$1 AND s.expires_at > now()`,
    [sha256(token)],
  );
  if (!r) return null;
  if (Date.now() - new Date(r.last_seen_at).getTime() > 3600_000) {
    await q(`UPDATE sessions SET last_seen_at=now() WHERE id=$1`, [r.session_id]);
  }
  return {
    id: r.id,
    email: r.email,
    displayName: r.display_name,
    emailVerified: !!r.email_verified_at,
    onboarded: !!r.onboarding_completed_at,
    isAdmin: r.is_admin,
    betaAllowlisted: r.beta_allowlisted,
    workspaceId: r.workspace_id,
    planKey: r.plan_key,
  };
}

export async function updateProfile(userId: string, displayName: string) {
  const name = z.string().trim().max(80).parse(displayName);
  await q(`UPDATE users SET display_name=$2, updated_at=now() WHERE id=$1`, [userId, name]);
}

export async function changePassword(userId: string, current: string, next: string) {
  const pw = z.string().min(10).max(200).parse(next);
  const u = await one<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id=$1`, [userId]);
  if (!u || !(await verifyPassword(current, u.password_hash))) throw new AppError("invalid_credentials", "Current password is incorrect.");
  await q(`UPDATE users SET password_hash=$2, updated_at=now() WHERE id=$1`, [userId, await hashPassword(pw)]);
  await q(`DELETE FROM sessions WHERE user_id=$1`, [userId]);
}

export async function completeOnboarding(userId: string) {
  await q(`UPDATE users SET onboarding_completed_at=COALESCE(onboarding_completed_at, now()) WHERE id=$1`, [userId]);
}

export async function setBetaAllowlist(actorId: string, userId: string, on: boolean) {
  await q(`UPDATE users SET beta_allowlisted=$2 WHERE id=$1`, [userId, on]);
  await audit(actorId, on ? "user.beta_allow" : "user.beta_revoke", `user:${userId}`);
}
