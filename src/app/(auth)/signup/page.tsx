"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice, inputCls } from "@/components/ui";
import { api } from "@/lib/api";

export default function Signup() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ devVerifyUrl: string | null }>("/api/auth/signup", { body: { email: f.get("email"), password: f.get("password"), displayName: f.get("displayName") ?? "", acceptTerms: f.get("terms") === "on" } });
      // Development only (no real email configured): go straight to the verification link.
      router.push(r.devVerifyUrl ?? "/onboarding");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold">Create your account</h1>
      <p className="mt-1 text-sm text-muted">Try every tool free with a few test images after you verify your email. No card needed.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Name" htmlFor="displayName"><input id="displayName" name="displayName" className={inputCls} autoComplete="name" maxLength={80} /></Field>
        <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" required className={inputCls} autoComplete="email" /></Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters."><input id="password" name="password" type="password" required minLength={10} className={inputCls} autoComplete="new-password" /></Field>
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" name="terms" required className="mt-1 accent-[var(--color-accent)]" />
          <span>I agree to the <Link className="text-accent" href="/legal/terms">Terms</Link> and <Link className="text-accent" href="/legal/acceptable-use">Acceptable Use Policy</Link>, and I will only upload images I have the rights and consent to use.</span>
        </label>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating account…" : "Create account"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">Already have an account? <Link href="/login" className="text-accent">Sign in</Link></p>
    </Card>
  );
}
