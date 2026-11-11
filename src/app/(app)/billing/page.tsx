import { currentUser } from "@/server/http";
import { billingSummary } from "@/server/billing";
import { getBalance } from "@/server/credits";
import { getPlan } from "@/server/entitlements";
import { q } from "@/server/db";
import { Card, PageHeader, Notice, fmtUsd } from "@/components/ui";
import { BillingActions } from "./billing-actions";

export const metadata = { title: "Billing" };

export default async function Billing({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const user = (await currentUser())!;
  const [summary, credits, plan, packs] = await Promise.all([
    billingSummary(user),
    getBalance(user.workspaceId),
    getPlan(user.planKey),
    q<{ key: string; display_name: string; price_cents: number; credits: number; stripe_price_id: string | null }>(`SELECT key, display_name, price_cents, credits, stripe_price_id FROM topup_packs WHERE active ORDER BY price_cents`),
  ]);
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader title="Billing and credits" />
      {sp.checkout === "success" && <Notice tone="ok">Thanks! Your plan updates as soon as Stripe confirms payment (usually a few seconds).</Notice>}
      {sp.topup === "success" && <Notice tone="ok">Payment received. Credits appear once Stripe confirms the payment.</Notice>}
      {!summary.configured && <Notice tone="warn">Billing isn&apos;t configured in this environment yet (Stripe test keys missing).</Notice>}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <p className="text-sm text-muted">Current plan</p>
          <p className="mt-1 text-2xl font-semibold">{plan.display_name}</p>
          {summary.subscription ? (
            <p className="mt-1 text-sm text-muted">
              {summary.subscription.billing_interval === "year" ? "Annual" : "Monthly"} · {summary.subscription.status}
              {summary.subscription.current_period_end && ` · ${summary.subscription.cancel_at_period_end ? "ends" : "renews"} ${new Date(summary.subscription.current_period_end).toLocaleDateString()}`}
            </p>
          ) : <p className="mt-1 text-sm text-muted">No active subscription.</p>}
          <BillingActions mode="plan" hasCustomer={summary.hasCustomer} isPaid={user.planKey !== "free"} />
        </Card>
        <Card>
          <p className="text-sm text-muted">Credits</p>
          <p className="mt-1 text-2xl font-semibold">{credits.balance} available</p>
          {credits.reserved > 0 && <p className="text-sm text-muted">{credits.reserved} reserved for running jobs</p>}
          <ul className="mt-3 space-y-1 text-xs text-muted">
            {summary.grants.map((g, i) => <li key={i}>{g.remaining} {g.source.replace("_", " ")} credits{g.expires_at ? ` · expire ${new Date(g.expires_at).toLocaleDateString()}` : ""}</li>)}
          </ul>
        </Card>
      </div>
      <Card>
        <h2 className="font-semibold">Top up credits</h2>
        <p className="mt-1 text-sm text-muted">{plan.allows_topups ? "Purchased credits are used after plan credits and last 12 months. Tax calculated at checkout." : "Top-ups are available on paid plans."}</p>
        <BillingActions mode="topup" packs={packs.map((p) => ({ key: p.key, label: `${p.credits.toLocaleString()} credits · ${fmtUsd(p.price_cents)}`, available: !!p.stripe_price_id && plan.allows_topups }))} />
      </Card>
      <Card>
        <h2 className="font-semibold">Credit history</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-muted"><tr><th className="py-2 font-medium">Date</th><th className="font-medium">Activity</th><th className="text-right font-medium">Change</th><th className="text-right font-medium">Balance</th></tr></thead>
            <tbody>
              {summary.ledger.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="py-2 text-muted">{new Date(l.created_at).toLocaleString()}</td>
                  <td>{l.description}</td>
                  <td className={`text-right ${l.amount > 0 ? "text-ok" : l.amount < 0 ? "text-ink" : "text-muted"}`}>{l.amount > 0 ? `+${l.amount}` : l.amount === 0 ? "—" : l.amount}</td>
                  <td className="text-right text-muted">{l.balance_after}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-muted">Invoices and receipts are available in the Stripe billing portal.</p>
      </Card>
    </div>
  );
}
