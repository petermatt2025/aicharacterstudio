import { describe, expect, it } from "vitest";
import { login, signup, userFromSessionToken, verifyEmail, destroySession } from "@/server/accounts";
import { canonicalEmail } from "@/server/crypto";
import { deleteAccount } from "@/server/deletion";
import { getBalance } from "@/server/credits";
import { one } from "@/server/db";
import { makeUser, uid, verificationTokenFor } from "./helpers";

describe("accounts", () => {
  it("signup → verify grants 15 one-time trial credits; login creates a session", async () => {
    const email = `a_${uid()}@example.com`;
    const { workspaceId } = await signup({ email, password: "correct horse battery", acceptTerms: true });
    expect((await getBalance(workspaceId)).balance).toBe(0); // nothing before verification
    const token = await verificationTokenFor(email);
    const r = await verifyEmail(token);
    expect(r.trialGranted).toBe(15);
    await expect(verifyEmail(token)).rejects.toMatchObject({ code: "validation_failed" }); // single use
    expect((await getBalance(workspaceId)).balance).toBe(15);
    const s = await login({ email, password: "correct horse battery" });
    const u = await userFromSessionToken(s.token);
    expect(u).toMatchObject({ email, emailVerified: true, planKey: "free", workspaceId });
    await destroySession(s.token);
    expect(await userFromSessionToken(s.token)).toBeNull();
  });

  it("rejects duplicate emails, short passwords and missing terms", async () => {
    const email = `d_${uid()}@example.com`;
    await signup({ email, password: "correct horse battery", acceptTerms: true });
    await expect(signup({ email: email.toUpperCase(), password: "correct horse battery", acceptTerms: true })).rejects.toMatchObject({ code: "email_taken" });
    await expect(signup({ email: `x_${uid()}@example.com`, password: "short", acceptTerms: true })).rejects.toThrow();
    // @ts-expect-error acceptTerms must be true
    await expect(signup({ email: `y_${uid()}@example.com`, password: "correct horse battery", acceptTerms: false })).rejects.toThrow();
  });

  it("invite-only sign-up rejects emails not on SIGNUP_ALLOWED_EMAILS", async () => {
    const { resetEnvCache } = await import("@/server/env");
    const invited = `inv_${uid()}@example.com`;
    process.env.SIGNUP_ALLOWED_EMAILS = ` ${invited.toUpperCase()} , other@example.com`;
    resetEnvCache();
    try {
      await expect(signup({ email: `stranger_${uid()}@example.com`, password: "correct horse battery", acceptTerms: true })).rejects.toMatchObject({ code: "forbidden" });
      await expect(signup({ email: invited, password: "correct horse battery", acceptTerms: true })).resolves.toHaveProperty("id");
    } finally {
      delete process.env.SIGNUP_ALLOWED_EMAILS;
      resetEnvCache();
    }
  });

  it("wrong password and unknown user give the same error", async () => {
    const u = await makeUser();
    await expect(login({ email: u.email, password: "nope-nope-nope" })).rejects.toMatchObject({ code: "invalid_credentials" });
    await expect(login({ email: `nobody_${uid()}@example.com`, password: "nope-nope-nope" })).rejects.toMatchObject({ code: "invalid_credentials" });
  });

  it("trial credits cannot be re-claimed with +tags, gmail dots, or after account deletion", async () => {
    expect(canonicalEmail("Jo.Hn+promo@GoogleMail.com")).toBe("john@gmail.com");
    const base = `trial${uid()}`;
    const first = await makeUser({ email: `${base}@gmail.com` });
    expect((await getBalance(first.workspaceId)).balance).toBe(15);
    const second = await makeUser({ email: `${base}+again@gmail.com` });
    expect((await getBalance(second.workspaceId)).balance).toBe(0);
    await deleteAccount(first, "correct horse battery");
    const third = await makeUser({ email: `${base}@gmail.com` });
    expect((await getBalance(third.workspaceId)).balance).toBe(0);
  });

  it("deleted accounts lose sessions and personal data", async () => {
    const u = await makeUser();
    await expect(deleteAccount(u, "wrong password!!")).rejects.toMatchObject({ code: "invalid_credentials" });
    await deleteAccount(u, "correct horse battery");
    expect(await userFromSessionToken(u.token)).toBeNull();
    const row = await one<{ email: string; status: string; display_name: string }>(`SELECT email, status, display_name FROM users WHERE id=$1`, [u.id]);
    expect(row).toMatchObject({ status: "deleted", display_name: "" });
    expect(row!.email).not.toContain("example.com");
    await expect(login({ email: u.email, password: "correct horse battery" })).rejects.toMatchObject({ code: "invalid_credentials" });
  });
});

describe("invite-only sign-up (admin managed)", () => {
  it("allows emails on the admin invite list, blocks others, and opens to all when switched on", async () => {
    const { signupAllowed } = await import("@/server/accounts");
    const { q } = await import("@/server/db");
    const invited = `invitee_${uid()}@example.com`;
    await q(`INSERT INTO app_settings (key, value) VALUES ('signup_invites', $1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`, [JSON.stringify([invited])]);
    await q(`INSERT INTO app_settings (key, value) VALUES ('signup_open', 'false') ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value`);
    try {
      expect(await signupAllowed(invited.toUpperCase())).toBe(true);
      expect(await signupAllowed(`stranger_${uid()}@example.com`)).toBe(false);
      await expect(signup({ email: `stranger_${uid()}@example.com`, password: "correct horse battery", acceptTerms: true })).rejects.toMatchObject({ code: "forbidden" });
      await q(`UPDATE app_settings SET value='true' WHERE key='signup_open'`);
      expect(await signupAllowed(`anyone_${uid()}@example.com`)).toBe(true);
    } finally {
      await q(`UPDATE app_settings SET value='[]' WHERE key='signup_invites'`);
      await q(`UPDATE app_settings SET value='false' WHERE key='signup_open'`);
    }
  });
});

describe("password reset", () => {
  it("forgot-password email link sets a new password, verifies the email, signs out old sessions, and is single-use", async () => {
    const { requestPasswordReset, resetPassword, adminResetLink, adminVerifyEmail, userFromSessionToken, login, createSession } = await import("@/server/accounts");
    const { one } = await import("@/server/db");
    const email = `reset_${uid()}@example.com`;
    const { id } = await signup({ email, password: "correct horse battery", acceptTerms: true });
    const old = await createSession(id);
    expect(await requestPasswordReset(email)).toEqual({ ok: true });
    expect(await requestPasswordReset(`nobody_${uid()}@example.com`)).toEqual({ ok: true }); // same answer, no enumeration
    const mail = await one<{ body_text: string }>(`SELECT body_text FROM email_outbox WHERE to_email=$1 AND subject LIKE 'Reset%' ORDER BY created_at DESC LIMIT 1`, [email]);
    const token = decodeURIComponent(/token=([^\s]+)/.exec(mail!.body_text)![1]!);
    const s = await resetPassword(token, "brand new password 1");
    expect((await userFromSessionToken(s.token))!.emailVerified).toBe(true);
    expect(await userFromSessionToken(old.token)).toBeNull();
    await expect(resetPassword(token, "another password 22")).rejects.toMatchObject({ code: "validation_failed" });
    await expect(login({ email, password: "correct horse battery" })).rejects.toMatchObject({ code: "invalid_credentials" });
    expect((await login({ email, password: "brand new password 1" })).token).toBeTruthy();

    // Admin tools: manual verify and a copyable reset link.
    const email2 = `support_${uid()}@example.com`;
    const u2 = await signup({ email: email2, password: "correct horse battery", acceptTerms: true });
    const admin = await makeUser({ admin: true });
    const r = await adminVerifyEmail(admin.id, u2.id);
    expect(r.trialGranted).toBe(15);
    const link = await adminResetLink(admin.id, u2.id);
    const t2 = decodeURIComponent(/token=([^\s]+)/.exec(link.url)![1]!);
    await resetPassword(t2, "support set password 9");
    expect((await login({ email: email2, password: "support set password 9" })).token).toBeTruthy();
  });
});

describe("email delivery failures", () => {
  it("sign-up still succeeds (and alerts the owner) when the email provider refuses to send", async () => {
    const { resetEnvCache } = await import("@/server/env");
    const { one } = await import("@/server/db");
    const saved = { t: process.env.EMAIL_TRANSPORT, k: process.env.RESEND_API_KEY, f: globalThis.fetch };
    process.env.EMAIL_TRANSPORT = "resend";
    process.env.RESEND_API_KEY = "re_test";
    resetEnvCache();
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes("api.resend.com")
        ? new Response(JSON.stringify({ message: "You can only send testing emails to your own email address" }), { status: 403 })
        : saved.f(url, init)) as typeof fetch;
    try {
      const email = `nomail_${uid()}@example.com`;
      const r = await signup({ email, password: "correct horse battery", acceptTerms: true });
      expect(r.emailSent).toBe(false);
      const row = await one<{ status: string; error: string }>(`SELECT status, error FROM email_outbox WHERE to_email=$1 ORDER BY created_at DESC LIMIT 1`, [email]);
      expect(row).toMatchObject({ status: "failed" });
      expect(row!.error).toMatch(/only send testing emails/);
      await new Promise((res) => setTimeout(res, 50));
      expect(await one(`SELECT 1 FROM alert_log WHERE kind='email_send' AND created_at > now() - interval '1 minute'`)).toBeTruthy();
      expect((await login({ email, password: "correct horse battery" })).token).toBeTruthy(); // the account works
    } finally {
      globalThis.fetch = saved.f;
      if (saved.t === undefined) delete process.env.EMAIL_TRANSPORT; else process.env.EMAIL_TRANSPORT = saved.t;
      if (saved.k === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = saved.k;
      resetEnvCache();
    }
  });
});
