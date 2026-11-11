"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Notice } from "./ui";

export function VerifyBanner() {
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <Notice tone="warn">
      Verify your email to unlock uploads, generation and your trial credits.{" "}
      {sent ? (
        <span>Sent. Check your inbox.</span>
      ) : (
        <button className="underline" onClick={() => api("/api/auth/resend", { method: "POST" }).then(() => setSent(true)).catch((e) => setErr((e as Error).message))}>Resend email</button>
      )}
      {err && <span className="ml-2">{err}</span>}
    </Notice>
  );
}
