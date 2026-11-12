import "server-only";
import { env } from "./env";
import { q } from "./db";
import { log } from "./audit";

export type Mail = { to: string; subject: string; text: string };

export class EmailSendError extends Error {}

/** Console transport stores mail in email_outbox (dev/test). Resend is used in staging/production. */
export async function sendMail(m: Mail) {
  const e = env();
  if (e.EMAIL_TRANSPORT === "resend") {
    if (!e.RESEND_API_KEY) throw new Error("RESEND_API_KEY is required for EMAIL_TRANSPORT=resend");
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${e.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: e.EMAIL_FROM, to: [m.to], subject: m.subject, text: m.text }),
    });
    const ok = res.ok;
    // Keep Resend's reason (e.g. "domain is not verified", "only send testing emails to your own address").
    const reason = ok ? null : `HTTP ${res.status}: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? "unknown"}`.slice(0, 300);
    await q(`INSERT INTO email_outbox (to_email, subject, body_text, transport, status, error) VALUES ($1,$2,$3,'resend',$4,$5)`, [
      m.to,
      m.subject,
      "[body not stored for resend transport]",
      ok ? "sent" : "failed",
      reason,
    ]);
    if (!ok) throw new EmailSendError(reason!);
    return;
  }
  await q(`INSERT INTO email_outbox (to_email, subject, body_text, transport) VALUES ($1,$2,$3,'console')`, [m.to, m.subject, m.text]);
  log("info", "email.console", { to: m.to, subject: m.subject });
  if (e.NODE_ENV === "development") console.log(`\n--- EMAIL to ${m.to}: ${m.subject}\n${m.text}\n---\n`);
}
