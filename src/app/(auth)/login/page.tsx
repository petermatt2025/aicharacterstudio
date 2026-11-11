"use client";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Field, Notice, inputCls } from "@/components/ui";
import { api } from "@/lib/api";

export default function Login() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/login", { body: { email: f.get("email"), password: f.get("password") } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold">Sign in</h1>
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email"><input id="email" name="email" type="email" required className={inputCls} autoComplete="email" /></Field>
        <Field label="Password" htmlFor="password"><input id="password" name="password" type="password" required className={inputCls} autoComplete="current-password" /></Field>
        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" className="w-full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</Button>
      </form>
      <p className="mt-6 text-center text-sm text-muted">New here? <Link href="/signup" className="text-accent">Create an account</Link></p>
    </Card>
  );
}
