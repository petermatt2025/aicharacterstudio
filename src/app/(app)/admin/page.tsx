import { notFound } from "next/navigation";
import { currentUser } from "@/server/http";
import { auditLog, listUsers, recentJobs, usageReport } from "@/server/admin";
import { listFeatures, listPlans } from "@/server/entitlements";
import { q } from "@/server/db";
import { providerConfigured } from "@/server/providers";
import { billingConfigured } from "@/server/billing";
import { env } from "@/server/env";
import { Card, PageHeader, Notice, fmtUsd } from "@/components/ui";
import { AdminFeatures, AdminRules, AdminSettings, AdminSignups, AdminUsers, StripePricesButton } from "./admin-client";

export const metadata = { title: "Admin" };

const usd = (v: string | null | number) => (v === null ? "unpriced" : `$${Number(v).toFixed(2)}`);

export default async function Admin({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const user = await currentUser();
  if (!user?.isAdmin) notFound(); // do not reveal the admin surface
  const days = (await searchParams).days === "7" ? 7 : 30;
  const [report, jobs, features, rules, settings, users, audit, plans] = await Promise.all([
    usageReport(user, days), recentJobs(user), listFeatures(),
    q<{ key: string; label: string; credits: string; per_outputs: number }>(`SELECT key, label, credits, per_outputs FROM credit_rules ORDER BY key`),
    q<{ key: string; value: unknown }>(`SELECT key, value FROM app_settings ORDER BY key`),
    listUsers(user), auditLog(user), listPlans(),
  ]);
  const totalCost = report.byFeature.reduce((s, r) => s + Number(r.cost_usd ?? 0), 0);
  const totalCredits = report.byFeature.reduce((s, r) => s + r.credits, 0);
  const revenue = totalCredits * report.creditValue;
  const margin = revenue - totalCost;
  const pct = (rev: number, cost: number) => (rev > 0 ? `${Math.round(((rev - cost) / rev) * 100)}%` : "—");
  const e = env();
  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader title="Admin" sub={`Last ${days} days · provider ${e.IMAGE_PROVIDER}/${e.OPENAI_IMAGE_MODEL} · Stripe ${billingConfigured() ? (e.STRIPE_SECRET_KEY?.startsWith("sk_live") ? "LIVE" : "test mode") : "not configured"}`} actions={<div className="flex gap-4 text-sm"><a className="text-accent" href="/admin/status">System status →</a><a className="text-accent" href={`/admin?days=${days === 30 ? 7 : 30}`}>Show {days === 30 ? 7 : 30} days</a></div>} />
      {!providerConfigured() && <Notice tone="warn">Image provider not configured: quotes will fail with provider_not_configured.</Notice>}
      {e.IMAGE_PROVIDER === "fake" && <Notice tone="warn">FAKE image provider active (test images only). Never enable in production.</Notice>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Card><p className="text-sm text-muted">Provider cost (est.)</p><p className="text-2xl font-semibold">${totalCost.toFixed(2)}</p><p className="text-xs text-muted">{report.byFeature.reduce((s, r) => s + r.unpriced, 0)} calls unpriced</p></Card>
        <Card><p className="text-sm text-muted">Est. gross margin</p><p className={`text-2xl font-semibold ${margin < 0 ? "text-bad" : "text-ok"}`}>${margin.toFixed(2)}</p><p className="text-xs text-muted">{totalCredits} credits × ${report.creditValue.toFixed(3)} − AI cost · {pct(revenue, totalCost)}</p></Card>
        <Card><p className="text-sm text-muted">MRR (list price)</p><p className="text-2xl font-semibold">{fmtUsd(report.mrrCents)}</p><p className="text-xs text-muted">Stripe is the source of truth</p></Card>
        <Card><p className="text-sm text-muted">Jobs</p><p className="text-2xl font-semibold">{report.jobs.reduce((s, j) => s + j.n, 0)}</p><p className="text-xs text-muted">{report.jobs.map((j) => `${j.status} ${j.n}`).join(" · ")}</p></Card>
        <Card><p className="text-sm text-muted">Cost / delivered image</p><p className="text-2xl font-semibold">{(() => { const o = report.jobs.reduce((s, j) => s + j.outputs, 0); return o ? `$${(totalCost / o).toFixed(3)}` : "—"; })()}</p></Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card><h2 className="font-semibold">Cost by tool</h2>
          <table className="mt-2 w-full text-sm"><thead className="text-left text-muted"><tr><th>Tool</th><th>Calls</th><th>Fail</th><th>Credits</th><th className="text-right">AI cost</th><th className="text-right">Margin</th></tr></thead>
            <tbody>{report.byFeature.map((r) => { const rev = r.credits * report.creditValue; const c = Number(r.cost_usd ?? 0); return <tr key={r.feature_key} className="border-t border-line"><td className="py-1">{r.feature_key}</td><td>{r.calls}</td><td>{r.failures}</td><td>{r.credits}</td><td className="text-right">{usd(r.cost_usd)}</td><td className={`text-right ${rev - c < 0 ? "text-bad" : ""}`}>{pct(rev, c)}</td></tr>; })}</tbody></table>
          <p className="mt-2 text-xs text-muted">Costs use the per-image estimates in Operations below (edit them to match your OpenAI/Google pricing). Margin = credits × credit value − AI cost.</p>
        </Card>
        <Card><h2 className="font-semibold">By plan / model</h2>
          <table className="mt-2 w-full text-sm"><thead className="text-left text-muted"><tr><th>Plan</th><th>Workspaces</th><th>Credits used</th><th className="text-right">Cost</th></tr></thead>
            <tbody>{report.byPlan.map((r) => <tr key={r.plan_key} className="border-t border-line"><td className="py-1">{r.plan_key}</td><td>{r.workspaces}</td><td>{r.credits_charged}</td><td className="text-right">{usd(r.cost_usd)}</td></tr>)}</tbody></table>
          <ul className="mt-3 text-xs text-muted">{report.byModel.map((m) => <li key={m.provider + m.model}>{m.provider}/{m.model}: {m.calls} calls · {usd(m.cost_usd)} · avg {m.avg_ms} ms</li>)}</ul>
          <p className="mt-2 text-xs text-muted">Funnel: {report.funnel.map((f) => `${f.name} ${f.n}`).join(" · ") || "no events"}</p>
        </Card>
      </div>

      <Card><h2 className="font-semibold">Top users by AI cost</h2>
        <table className="mt-2 w-full text-sm"><thead className="text-left text-muted"><tr><th>User</th><th>Calls</th><th>Credits</th><th className="text-right">AI cost</th><th className="text-right">Margin</th></tr></thead>
          <tbody>{report.topUsers.map((r) => { const rev = r.credits * report.creditValue; const c = Number(r.cost_usd ?? 0); return <tr key={r.workspace_id} className="border-t border-line"><td className="py-1">{r.email}</td><td>{r.calls}</td><td>{r.credits}</td><td className="text-right">{usd(r.cost_usd)}</td><td className={`text-right ${rev - c < 0 ? "text-bad" : ""}`}>{pct(rev, c)}</td></tr>; })}</tbody></table>
      </Card>
      <AdminSignups
        invites={(settings.find((s) => s.key === "signup_invites")?.value as string[] | undefined) ?? []}
        open={settings.find((s) => s.key === "signup_open")?.value === true}
        envCount={e.SIGNUP_ALLOWED_EMAILS.split(",").map((x) => x.trim()).filter(Boolean).length}
      />
      <AdminSettings settings={settings} />
      <AdminFeatures features={features.map((f) => ({ key: f.key, name: f.name, tool: f.tool_number, state: f.release_state, tier: f.min_tier, multiplier: Number(f.credit_multiplier), cap: f.daily_cost_cap_usd === null ? null : Number(f.daily_cost_cap_usd) }))} />
      <AdminRules rules={rules.map((r) => ({ key: r.key, label: r.label, credits: Number(r.credits), perOutputs: r.per_outputs }))} />
      <Card><h2 className="font-semibold">Plans and Stripe prices</h2>
        <table className="mt-2 w-full text-sm"><thead className="text-left text-muted"><tr><th>Plan</th><th>Credits/mo</th><th>Monthly price ID</th><th>Annual price ID</th></tr></thead>
          <tbody>{plans.map((p) => <tr key={p.key} className="border-t border-line"><td className="py-1">{p.display_name}</td><td>{p.monthly_credits}</td><td className="font-mono text-xs">{p.stripe_price_monthly ?? "—"}</td><td className="font-mono text-xs">{p.stripe_price_annual ?? "—"}</td></tr>)}</tbody></table>
        <StripePricesButton />
      </Card>
      <AdminUsers users={JSON.parse(JSON.stringify(users))} />
      <Card><h2 className="font-semibold">Recent jobs</h2>
        <div className="overflow-x-auto"><table className="mt-2 w-full min-w-[800px] text-xs"><thead className="text-left text-muted"><tr><th>When</th><th>User</th><th>Tool</th><th>Status</th><th>Attempts</th><th>Out</th><th>Credits</th><th>Error</th></tr></thead>
          <tbody>{(jobs as Array<Record<string, unknown>>).map((j) => <tr key={String(j.id)} className="border-t border-line"><td className="py-1">{new Date(j.created_at as string).toLocaleString()}</td><td>{String(j.email ?? "—")}</td><td>{String(j.feature_key)}</td><td>{String(j.status)}</td><td>{String(j.attempts)}</td><td>{String(j.outputs_delivered)}/{String(j.outputs_requested)}</td><td>{String(j.credits_charged)}</td><td className="text-bad">{String(j.error_code ?? "")}</td></tr>)}</tbody></table></div>
      </Card>
      <Card><h2 className="font-semibold">Audit log</h2>
        <ul className="mt-2 max-h-80 space-y-1 overflow-auto text-xs text-muted">{(audit as Array<Record<string, unknown>>).map((a) => <li key={String(a.id)}>{new Date(a.created_at as string).toLocaleString()} · {String(a.actor ?? "system")} · {String(a.action)} · {String(a.target)}</li>)}</ul>
      </Card>
    </div>
  );
}
