"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { Button, ButtonLink, Notice } from "@/components/ui";

export function BillingActions(props: { mode: "plan"; hasCustomer: boolean; isPaid: boolean } | { mode: "topup"; packs: Array<{ key: string; label: string; available: boolean }> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function go(path: string, body: unknown, key: string) {
    setBusy(key);
    setError(null);
    try {
      const r = await api<{ url: string }>(path, { body });
      window.location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }
  return (
    <div className="mt-4 space-y-3">
      {props.mode === "plan" ? (
        <div className="flex flex-wrap gap-2">
          {props.hasCustomer && <Button variant="secondary" disabled={busy !== null} onClick={() => go("/api/billing/portal", {}, "portal")}>{busy === "portal" ? "Opening…" : "Manage billing, invoices, cancel"}</Button>}
          <ButtonLink href="/pricing" variant={props.isPaid ? "ghost" : "primary"}>{props.isPaid ? "Compare plans" : "Upgrade"}</ButtonLink>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {props.packs.map((p) => (
            <Button key={p.key} variant="secondary" disabled={!p.available || busy !== null} onClick={() => go("/api/billing/top-up", { packKey: p.key }, p.key)}>{busy === p.key ? "Redirecting…" : p.label}</Button>
          ))}
        </div>
      )}
      {error && <Notice tone="error">{error}</Notice>}
    </div>
  );
}
