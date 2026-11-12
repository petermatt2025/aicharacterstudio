"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button, Card, Notice, inputCls } from "@/components/ui";

function useAction() {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const run = async (fn: () => Promise<unknown>) => {
    setErr(null);
    try { await fn(); router.refresh(); } catch (e) { setErr((e as Error).message); }
  };
  return { err, run };
}

type F = { key: string; name: string; tool: number | null; state: string; tier: string; multiplier: number; cap: number | null };
export function AdminFeatures({ features }: { features: F[] }) {
  const { err, run } = useAction();
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Feature flags</h2>
        {features.some((f) => f.state === "beta") && (
          <Button onClick={() => { if (confirm("Make every beta tool live? All paying customers (by plan) can then use them.")) run(() => api("/api/admin/features/publish-all", { method: "POST" })); }}>Make all tools live</Button>
        )}
      </div>
      <p className="text-xs text-muted">Beta = only admins and beta-list users (and free trials). Live = every customer whose plan includes the tool. Unimplemented tools stay unusable regardless of state.</p>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-muted"><tr><th>#</th><th>Tool</th><th>State</th><th>Min tier</th><th>Multiplier</th><th>Daily cap $</th></tr></thead>
        <tbody>{features.map((f) => (
          <tr key={f.key} className="border-t border-line">
            <td className="py-1 text-muted">{f.tool ?? "–"}</td><td>{f.name}</td>
            <td><select aria-label={`${f.name} state`} className={inputCls} defaultValue={f.state} onChange={(e) => run(() => api(`/api/admin/features/${f.key}`, { method: "PATCH", body: { releaseState: e.target.value } }))}>{["planned", "coming_soon", "beta", "live", "paused"].map((s) => <option key={s}>{s}</option>)}</select></td>
            <td><select aria-label={`${f.name} tier`} className={inputCls} defaultValue={f.tier} onChange={(e) => run(() => api(`/api/admin/features/${f.key}`, { method: "PATCH", body: { minTier: e.target.value } }))}>{["free", "creator", "pro", "agency"].map((s) => <option key={s}>{s}</option>)}</select></td>
            <td><input aria-label={`${f.name} multiplier`} className={inputCls + " w-20"} type="number" step="0.1" min="0.1" defaultValue={f.multiplier} onBlur={(e) => Number(e.target.value) !== f.multiplier && run(() => api(`/api/admin/features/${f.key}`, { method: "PATCH", body: { creditMultiplier: Number(e.target.value) } }))} /></td>
            <td><input aria-label={`${f.name} daily cap`} className={inputCls + " w-24"} type="number" min="0" defaultValue={f.cap ?? ""} placeholder="none" onBlur={(e) => run(() => api(`/api/admin/features/${f.key}`, { method: "PATCH", body: { dailyCostCapUsd: e.target.value === "" ? null : Number(e.target.value) } }))} /></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

export function AdminRules({ rules }: { rules: Array<{ key: string; label: string; credits: number; perOutputs: number }> }) {
  const { err, run } = useAction();
  return (
    <Card>
      <h2 className="font-semibold">Credit rules</h2>
      {err && <Notice tone="error">{err}</Notice>}
      <ul className="mt-2 grid gap-2 md:grid-cols-2">{rules.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-2 text-sm">
          <span>{r.label} <span className="text-xs text-muted">({r.key}, per {r.perOutputs})</span></span>
          <input aria-label={`${r.label} credits`} className={inputCls + " w-24"} type="number" step="0.5" min="0.5" defaultValue={r.credits} onBlur={(e) => Number(e.target.value) !== r.credits && run(() => api(`/api/admin/credit-rules/${r.key}`, { method: "PATCH", body: { credits: Number(e.target.value) } }))} />
        </li>
      ))}</ul>
    </Card>
  );
}

export function AdminSettings({ settings }: { settings: Array<{ key: string; value: unknown }> }) {
  const { err, run } = useAction();
  const enabled = settings.find((s) => s.key === "generation_enabled")?.value !== false;
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Operations</h2>
        <Button variant={enabled ? "danger" : "primary"} onClick={() => run(() => api("/api/admin/settings/generation_enabled", { method: "PATCH", body: { value: !enabled } }))}>{enabled ? "Kill switch: pause all generation" : "Resume generation"}</Button>
      </div>
      {err && <Notice tone="error">{err}</Notice>}
      <ul className="mt-3 grid gap-2 md:grid-cols-2">{settings.filter((s) => typeof s.value === "number").map((s) => (
        <li key={s.key} className="flex items-center justify-between gap-2 text-sm">
          <span>{s.key}</span>
          <input aria-label={s.key} className={inputCls + " w-28"} type="number" defaultValue={s.value as number} onBlur={(e) => Number(e.target.value) !== s.value && run(() => api(`/api/admin/settings/${s.key}`, { method: "PATCH", body: { value: Number(e.target.value) } }))} />
        </li>
      ))}</ul>
    </Card>
  );
}

type U = { id: string; email: string; plan_key: string; has_subscription?: boolean; balance: number | null; beta_allowlisted: boolean; is_admin: boolean; workspace_id: string; email_verified_at: string | null };
export function AdminUsers({ users }: { users: U[] }) {
  const { err, run } = useAction();
  return (
    <Card>
      <h2 className="font-semibold">Users</h2>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-muted"><tr><th>Email</th><th>Plan</th><th>Credits</th><th>Verified</th><th>Beta</th><th>Actions</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} className="border-t border-line">
            <td className="py-1">{u.email}{u.is_admin ? " (admin)" : ""}</td><td>
              <select aria-label={`Plan for ${u.email}`} className={inputCls + " w-28 py-1"} defaultValue={u.plan_key} disabled={!u.workspace_id}
                onChange={(e) => {
                  const planKey = e.target.value;
                  const paid = planKey !== "free";
                  const warn = u.has_subscription ? "\n\nNote: this user pays through Stripe; their plan will follow Stripe again at their next billing event." : "";
                  if (!confirm(`Change ${u.email} to ${planKey.toUpperCase()}?${warn}`)) { e.target.value = u.plan_key; return; }
                  const grant = paid && confirm(`Also add the ${planKey} plan's monthly credits now? (Given by hand, they expire in 31 days and don't renew automatically.)`);
                  run(() => api("/api/admin/users", { body: { action: "set_plan", workspaceId: u.workspace_id, planKey, grantCredits: grant } }));
                }}>
                {["free", "creator", "pro", "agency"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
              {u.has_subscription && <span className="ml-1 text-[10px] text-muted" title="Pays through Stripe">$</span>}
            </td><td>{u.balance ?? 0}</td><td>{u.email_verified_at ? "yes" : "no"}</td>
            <td><input type="checkbox" aria-label={`Beta access for ${u.email}`} defaultChecked={u.beta_allowlisted} onChange={(e) => run(() => api("/api/admin/users", { body: { action: "beta", userId: u.id, on: e.target.checked } }))} /></td>
            <td className="whitespace-nowrap">
              <Button variant="ghost" onClick={() => { const n = Number(prompt("Credits to grant", "10")); const note = prompt("Reason (audited)") ?? ""; if (n > 0 && u.workspace_id) run(() => api("/api/admin/users", { body: { action: "grant", workspaceId: u.workspace_id, amount: n, note } })); }}>Grant…</Button>
              {!u.email_verified_at && <Button variant="ghost" onClick={() => run(() => api("/api/admin/users", { body: { action: "verify", userId: u.id } }))}>Verify</Button>}
              {!u.is_admin && <Button variant="ghost" onClick={() => run(async () => { const r = await api<{ url: string; expiresInHours: number }>("/api/admin/users", { body: { action: "reset_link", userId: u.id } }); await navigator.clipboard.writeText(r.url).catch(() => {}); prompt(`One-time password reset link for ${u.email} (copied; valid ${r.expiresInHours}h). Send it to them privately:`, r.url); })}>Reset link</Button>}
            </td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}

export function StripePricesButton() {
  const [state, setState] = useState<{ busy: boolean; msg: string | null; tone: "ok" | "error" }>({ busy: false, msg: null, tone: "ok" });
  async function go() {
    setState({ busy: true, msg: null, tone: "ok" });
    try {
      const r = await api<{ created: number; total: number; livemode: boolean }>("/api/admin/stripe-prices", { method: "POST" });
      setState({ busy: false, tone: "ok", msg: `Done: ${r.total} prices ready in your Stripe ${r.livemode ? "LIVE" : "test"} account (${r.created} newly created). Reload to see the IDs.` });
    } catch (e) {
      setState({ busy: false, tone: "error", msg: (e as Error).message });
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Button onClick={() => void go()} disabled={state.busy}>{state.busy ? "Setting up…" : "Set up Stripe prices"}</Button>
      <p className="text-xs text-muted">Creates (or finds) the products and prices for every paid plan and credit pack in the Stripe account your STRIPE_SECRET_KEY belongs to, and saves their IDs here. Safe to click again.</p>
      {state.msg && <Notice tone={state.tone}>{state.msg}</Notice>}
    </div>
  );
}

export function AdminSignups({ invites, open, envCount }: { invites: string[]; open: boolean; envCount: number }) {
  const { err, run } = useAction();
  const [text, setText] = useState(invites.join("\n"));
  const [saved, setSaved] = useState(false);
  const emails = text.split(/[\s,;]+/).map((x) => x.trim().toLowerCase()).filter(Boolean);
  const bad = emails.filter((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x));
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Sign-ups</h2>
        <Button variant={open ? "danger" : "secondary"} onClick={() => run(() => api("/api/admin/settings/signup_open", { method: "PATCH", body: { value: !open } }))}>
          {open ? "Close sign-up (invite-only)" : "Open sign-up to everyone"}
        </Button>
      </div>
      <p className="mt-1 text-sm text-muted">{open ? "Anyone can create an account right now (each verified email gets the free trial credits once)." : "Invite-only: only the emails below can create an account."}</p>
      {err && <Notice tone="error">{err}</Notice>}
      <label className="mt-3 block text-sm" htmlFor="invites">Invited emails (one per line)</label>
      <textarea id="invites" rows={5} className={inputCls + " mt-1 font-mono text-xs"} value={text} onChange={(e) => { setText(e.target.value); setSaved(false); }} placeholder={"friend@gmail.com\ncolleague@company.com"} />
      {bad.length > 0 && <p className="mt-1 text-xs text-bad">Not an email: {bad.join(", ")}</p>}
      <div className="mt-2 flex items-center gap-3">
        <Button disabled={bad.length > 0} onClick={() => run(async () => { await api("/api/admin/settings/signup_invites", { method: "PATCH", body: { value: emails } }); setSaved(true); })}>Save invites ({emails.length})</Button>
        {saved && <span className="text-sm text-ok">Saved: these people can sign up now.</span>}
      </div>
      {envCount > 0 && <p className="mt-2 text-xs text-muted">Also allowed: {envCount} email(s) from the SIGNUP_ALLOWED_EMAILS variable on Railway.</p>}
    </Card>
  );
}
