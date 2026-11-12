import type { Metadata } from "next";
import { listFeatures, listPlans } from "@/server/entitlements";
import { q } from "@/server/db";
import { currentUser } from "@/server/http";
import { PLAN_RANK, type PlanKey } from "@/lib/catalog";
import { Badge, Card, fmtUsd } from "@/components/ui";
import { PricingActions } from "./pricing-actions";
import { env } from "@/server/env";

export const metadata: Metadata = { title: "Pricing" };

export default async function Pricing() {
  const [plans, features, rules, user] = await Promise.all([
    listPlans(),
    listFeatures(),
    q<{ key: string; label: string; credits: string; per_outputs: number }>(`SELECT key, label, credits, per_outputs FROM credit_rules ORDER BY credits::numeric / per_outputs`),
    currentUser(),
  ]);
  const tools = features.filter((f) => f.release_state !== "planned");
  return (
    <div className="mx-auto max-w-6xl px-4 py-14">
      <h1 className="text-center text-4xl font-semibold tracking-tight">Simple plans, honest credits</h1>
      <p className="mx-auto mt-3 max-w-2xl text-center text-muted">
        Credits are charged only for delivered images. Prices in USD; applicable taxes (such as VAT) are calculated at checkout based on your location.
      </p>
      <PricingActions
        signedIn={!!user}
        currentPlan={user?.planKey ?? null}
        liveMode={/^(sk|rk)_live_/.test(env().STRIPE_SECRET_KEY ?? "") && env().STRIPE_ALLOW_LIVE_MODE}
        plans={plans.map((p) => ({ key: p.key, name: p.display_name, description: p.description, monthlyCents: p.monthly_price_cents, annualCents: p.annual_price_cents, monthlyCredits: p.monthly_credits, monthlyPurchasable: !!p.stripe_price_monthly, annualPurchasable: !!p.stripe_price_annual, watermark: p.watermark, concurrent: p.max_concurrent_jobs, seats: p.seat_cap }))}
      />

      <h2 className="mt-16 text-2xl font-semibold">What each plan unlocks</h2>
      <p className="mt-1 text-sm text-muted">Only tools marked Beta or Live can be used today. Coming-soon tools are not included in any purchase until they ship.</p>
      <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-surface-2 text-left text-muted">
            <tr>
              <th className="p-3 font-medium">Tool</th>
              <th className="p-3 font-medium">Status</th>
              {plans.map((p) => <th key={p.key} className="p-3 text-center font-medium">{p.display_name}</th>)}
            </tr>
          </thead>
          <tbody>
            {tools.map((f) => (
              <tr key={f.key} className="border-t border-line">
                <td className="p-3">{f.name}</td>
                <td className="p-3"><Badge tone={f.release_state} /></td>
                {plans.map((p) => {
                  const ok = PLAN_RANK[p.key as PlanKey] >= PLAN_RANK[f.min_tier] && !(f.key === "photoshoot" && !p.allows_photoshoot);
                  return <td key={p.key} className="p-3 text-center">{ok ? (f.release_state === "coming_soon" ? <span className="text-muted">soon</span> : "✓") : <span className="text-muted">—</span>}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-16 grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="text-lg font-semibold">Credit costs</h2>
          <p className="mt-1 text-sm text-muted">Starting rates. The exact quote is always shown before you generate.</p>
          <ul className="mt-4 space-y-2 text-sm">
            {rules.map((r) => (
              <li key={r.key} className="flex justify-between gap-4 border-b border-line/60 pb-2">
                <span>{r.label}</span>
                <span className="text-muted">{Number(r.credits)} credits{r.per_outputs > 1 ? ` / ${r.per_outputs} images` : " / image"}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <h2 className="text-lg font-semibold">The fine print</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-muted">
            <li>Free trial: 15 one-time credits per person, expiring after 30 days.</li>
            <li>Monthly plan credits expire at the end of each billing period. Annual plans receive credits monthly.</li>
            <li>Top-up credits (paid plans) are spent after plan credits and last 12 months.</li>
            <li>Failed or blocked generations return unused credits automatically. No overages, no negative balances.</li>
            <li>Downgrades take effect at the end of the current period. Upgrades apply after payment with prorated pricing shown by Stripe.</li>
            <li>Likeness, products, logos and text are never guaranteed to be exact.</li>
          </ul>
          <p className="mt-4 text-xs text-muted">Top-up packs: {fmtUsd(1200)} for 100 · {fmtUsd(4900)} for 500 · {fmtUsd(9900)} for 1,200 credits.</p>
        </Card>
      </div>
    </div>
  );
}
