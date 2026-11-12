"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, Notice, fmtUsd, cx } from "@/components/ui";
import { api } from "@/lib/api";

type Plan = { key: string; name: string; description: string; monthlyCents: number; annualCents: number; monthlyCredits: number; monthlyPurchasable: boolean; annualPurchasable: boolean; watermark: boolean; concurrent: number; seats: number };

export function PricingActions({ plans, signedIn, currentPlan }: { plans: Plan[]; signedIn: boolean; currentPlan: string | null }) {
  const [interval, setInterval] = useState<"month" | "year">("month");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const router = useRouter();

  async function choose(p: Plan) {
    if (!signedIn) return router.push(`/signup?plan=${p.key}`);
    if (p.key === "free") return router.push(currentPlan && currentPlan !== "free" ? "/billing" : "/dashboard");
    setBusy(p.key);
    setError(null);
    try {
      if (currentPlan && currentPlan !== "free") {
        const rank: Record<string, number> = { free: 0, creator: 1, pro: 2, agency: 3 };
        const up = (rank[p.key] ?? 0) > (rank[currentPlan] ?? 0);
        const msg = up
          ? `Upgrade to ${p.name}? You'll be charged the prorated difference now and your extra credits are added right away.`
          : `Switch to ${p.name}? The change applies now; unused time on your current plan is credited on your next invoice. Credits you already have stay until they expire.`;
        if (!confirm(msg)) return;
        await api("/api/billing/change-plan", { body: { planKey: p.key, interval } });
        setDone(`You're now on ${p.name}.${up ? " Your extra credits arrive within a few seconds." : ""}`);
        router.refresh();
        return;
      }
      const r = await api<{ url: string }>("/api/billing/checkout", { body: { planKey: p.key, interval } });
      window.location.assign(r.url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <div className="mt-8 flex justify-center">
        <div role="radiogroup" aria-label="Billing interval" className="inline-flex rounded-full border border-line bg-surface p-1 text-sm">
          {(["month", "year"] as const).map((i) => (
            <button key={i} role="radio" aria-checked={interval === i} onClick={() => setInterval(i)} className={cx("rounded-full px-4 py-1.5", interval === i ? "bg-accent text-accent-ink" : "text-muted")}>
              {i === "month" ? "Monthly" : "Annual (2 months free)"}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="mx-auto mt-4 max-w-lg"><Notice tone="error">{error}</Notice></div>}
      {done && <div className="mx-auto mt-4 max-w-lg"><Notice tone="ok">{done}</Notice></div>}
      <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {plans.map((p) => {
          const price = interval === "month" ? p.monthlyCents : p.annualCents;
          const purchasable = p.key === "free" || (interval === "month" ? p.monthlyPurchasable : p.annualPurchasable);
          const isCurrent = currentPlan === p.key;
          return (
            <Card key={p.key} className={cx("flex flex-col", p.key === "pro" && "border-accent/60")}>
              <h2 className="text-lg font-semibold">{p.name}</h2>
              <p className="mt-1 min-h-10 text-sm text-muted">{p.description}</p>
              <p className="mt-4 text-3xl font-semibold">{fmtUsd(price)}<span className="text-sm font-normal text-muted">{p.key === "free" ? "" : interval === "month" ? " /mo" : " /yr"}</span></p>
              <p className="text-xs text-muted">+ applicable tax</p>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm">
                <li>{p.key === "free" ? "15 one-time trial credits" : `${p.monthlyCredits.toLocaleString()} credits / month`}</li>
                <li>{p.watermark ? "Watermarked, 1024px" : "No watermark, high resolution"}</li>
                <li>{p.concurrent} generation{p.concurrent > 1 ? "s" : ""} at once</li>
                {p.seats > 1 && <li>{p.seats} seats (team features coming soon)</li>}
              </ul>
              <Button className="mt-6 w-full" variant={p.key === "pro" ? "primary" : "secondary"} disabled={isCurrent || !purchasable || busy === p.key} onClick={() => choose(p)}>
                {isCurrent ? "Current plan" : !purchasable ? "Not yet available" : busy === p.key ? "Working…" : p.key === "free" ? (currentPlan && currentPlan !== "free" ? "Cancel via Manage billing" : "Start free") : currentPlan && currentPlan !== "free" ? `Switch to ${p.name}` : `Choose ${p.name}`}
              </Button>
            </Card>
          );
        })}
      </div>
      <p className="mt-4 text-center text-xs text-muted">Payments are processed by Stripe. This environment uses Stripe test mode; no real charges are made.</p>
    </>
  );
}
