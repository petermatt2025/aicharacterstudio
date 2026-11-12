"use client";
import Link from "next/link";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, Notice, inputCls } from "@/components/ui";
import { api } from "@/lib/api";

function Reset() {
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    if (f.get("password") !== f.get("confirm")) return setError("The two passwords do not match.");
    setBusy(true);
    setError(null);
    try {
      await api("/api/auth/reset", { body: { token, password: f.get("password") } });
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }
  return (
    <Card className="p-7">
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      {!token ? (
        <Notice tone="error">This link is incomplete. <Link href="/forgot-password" className="underline">Ask for a new one</Link>.</Notice>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field label="New password" htmlFor="password" hint="At least 10 characters."><input id="password" name="password" type="password" minLength={10} required className={inputCls} autoComplete="new-password" /></Field>
          <Field label="Repeat it" htmlFor="confirm"><input id="confirm" name="confirm" type="password" minLength={10} required className={inputCls} autoComplete="new-password" /></Field>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Saving…" : "Save and sign in"}</Button>
        </form>
      )}
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
