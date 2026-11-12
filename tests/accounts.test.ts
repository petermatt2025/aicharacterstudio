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
