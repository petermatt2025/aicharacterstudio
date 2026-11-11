"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ButtonLink, Card, Notice } from "@/components/ui";
import { api } from "@/lib/api";

function Verify() {
  const token = useSearchParams().get("token");
  const [state, setState] = useState<{ ok?: boolean; trial?: number; error?: string }>({});
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current || !token) return;
    ran.current = true;
    api<{ trialGranted: number }>("/api/auth/verify", { body: { token } })
      .then((r) => setState({ ok: true, trial: r.trialGranted }))
      .catch((e) => setState({ error: (e as Error).message }));
  }, [token]);
  return (
    <Card className="p-7 text-center">
      <h1 className="text-xl font-semibold">Email verification</h1>
      <div className="mt-6">
        {!token && <Notice tone="error">Missing verification token.</Notice>}
        {token && !state.ok && !state.error && <p className="text-muted">Verifying…</p>}
        {state.error && <Notice tone="error">{state.error}</Notice>}
        {state.ok && <Notice tone="ok">Email verified.{state.trial ? ` ${state.trial} trial credits added.` : ""}</Notice>}
      </div>
      <ButtonLink href="/onboarding" className="mt-6">Continue</ButtonLink>
    </Card>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
