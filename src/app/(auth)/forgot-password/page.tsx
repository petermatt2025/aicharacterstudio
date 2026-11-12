"use client";
import Link from "next/link";
import { useState } from "react";
import { Button, Card, Field, Notice, inputCls } from "@/components/ui";
import { api } from "@/lib/api";

export default function ForgotPassword() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/forgot", { body: { email: new FormData(e.currentTarget).get("email") } });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold">Forgot your password?</h1>
      {sent ? (
        <Notice tone="ok">If an account exists for that email, we have sent a link to choose a new password. It expires in 2 hours. Check your spam folder too.</Notice>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <p className="text-sm text-muted">Enter your email and we will send you a link to choose a new password.</p>
          <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" required className={inputCls} autoComplete="email" /></Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Sending…" : "Send reset link"}</Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm text-muted"><Link href="/login" className="text-accent">Back to sign in</Link></p>
    </Card>
  );
}
