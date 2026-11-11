"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Field, Notice, inputCls } from "@/components/ui";
import { CONSENT_LABELS, type ConsentSubject } from "@/lib/consent";

export function SettingsForms({ displayName, email, receipts }: { displayName: string; email: string; receipts: Array<{ id: string; subject: string; statement_version: string; created_at: string }> }) {
  const router = useRouter();
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string; area: string } | null>(null);

  async function act(area: string, fn: () => Promise<unknown>, ok: string, after?: () => void) {
    setMsg(null);
    try { await fn(); setMsg({ tone: "ok", text: ok, area }); after?.(); } catch (e) { setMsg({ tone: "error", text: (e as Error).message, area }); }
  }
  const note = (area: string) => msg?.area === area && <Notice tone={msg.tone}>{msg.text}</Notice>;

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-semibold">Profile</h2>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act("profile", () => api("/api/me", { method: "PATCH", body: { displayName: f.get("displayName") } }), "Saved.", () => router.refresh()); }}>
          <Field label="Email" htmlFor="email"><input id="email" className={inputCls} value={email} disabled /></Field>
          <Field label="Display name" htmlFor="displayName"><input id="displayName" name="displayName" className={inputCls} defaultValue={displayName} maxLength={80} /></Field>
          {note("profile")}
          <Button type="submit" variant="secondary">Save</Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Password</h2>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act("pw", () => api("/api/me/password", { body: { current: f.get("current"), next: f.get("next") } }), "Password changed. Please sign in again.", () => router.push("/login")); }}>
          <Field label="Current password" htmlFor="current"><input id="current" name="current" type="password" className={inputCls} autoComplete="current-password" required /></Field>
          <Field label="New password" htmlFor="next" hint="At least 10 characters. You'll be signed out everywhere."><input id="next" name="next" type="password" minLength={10} className={inputCls} autoComplete="new-password" required /></Field>
          {note("pw")}
          <Button type="submit" variant="secondary">Change password</Button>
        </form>
      </Card>
      <Card>
        <h2 className="font-semibold">Privacy and consent receipts</h2>
        <p className="mt-1 text-sm text-muted">Each upload records the rights statement you confirmed.</p>
        <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-xs text-muted">
          {receipts.length === 0 && <li>No uploads yet.</li>}
          {receipts.map((r) => <li key={r.id}>{new Date(r.created_at).toLocaleString()} · {CONSENT_LABELS[r.subject as ConsentSubject] ?? r.subject} (v{r.statement_version})</li>)}
        </ul>
      </Card>
      <Card className="border-bad/40">
        <h2 className="font-semibold text-bad">Delete account</h2>
        <p className="mt-1 text-sm text-muted">Cancels any subscription, deletes all uploaded and generated images, and anonymizes your account. Remaining credits are forfeited. This cannot be undone.</p>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); act("delete", () => api("/api/me/delete", { body: { password: f.get("password"), confirm: f.get("confirm"), reason: f.get("reason") || undefined } }), "Account deleted.", () => { router.push("/"); router.refresh(); }); }}>
          <Field label="Password" htmlFor="delpw"><input id="delpw" name="password" type="password" className={inputCls} required /></Field>
          <Field label='Type "DELETE" to confirm' htmlFor="confirm"><input id="confirm" name="confirm" className={inputCls} required pattern="DELETE" /></Field>
          <Field label="Reason (optional)" htmlFor="reason"><input id="reason" name="reason" className={inputCls} maxLength={500} /></Field>
          {note("delete")}
          <Button type="submit" variant="danger">Delete my account</Button>
        </form>
      </Card>
    </div>
  );
}
