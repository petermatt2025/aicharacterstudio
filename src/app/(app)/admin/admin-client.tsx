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
      <h2 className="font-semibold">Feature flags</h2>
      <p className="text-xs text-muted">Flip a tool to live only after its real-provider end-to-end test passes. Unimplemented tools stay unusable regardless of state.</p>
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

type U = { id: string; email: string; plan_key: string; balance: number | null; beta_allowlisted: boolean; is_admin: boolean; workspace_id: string; email_verified_at: string | null };
export function AdminUsers({ users }: { users: U[] }) {
  const { err, run } = useAction();
  return (
    <Card>
      <h2 className="font-semibold">Users</h2>
      {err && <Notice tone="error">{err}</Notice>}
      <div className="mt-2 overflow-x-auto"><table className="w-full min-w-[720px] text-sm">
        <thead className="text-left text-muted"><tr><th>Email</th><th>Plan</th><th>Credits</th><th>Verified</th><th>Beta</th><th>Grant</th></tr></thead>
        <tbody>{users.map((u) => (
          <tr key={u.id} className="border-t border-line">
            <td className="py-1">{u.email}{u.is_admin ? " (admin)" : ""}</td><td>{u.plan_key}</td><td>{u.balance ?? 0}</td><td>{u.email_verified_at ? "yes" : "no"}</td>
            <td><input type="checkbox" aria-label={`Beta access for ${u.email}`} defaultChecked={u.beta_allowlisted} onChange={(e) => run(() => api("/api/admin/users", { body: { action: "beta", userId: u.id, on: e.target.checked } }))} /></td>
            <td><Button variant="ghost" onClick={() => { const n = Number(prompt("Credits to grant", "10")); const note = prompt("Reason (audited)") ?? ""; if (n > 0 && u.workspace_id) run(() => api("/api/admin/users", { body: { action: "grant", workspaceId: u.workspace_id, amount: n, note } })); }}>Grant…</Button></td>
          </tr>
        ))}</tbody>
      </table></div>
    </Card>
  );
}
