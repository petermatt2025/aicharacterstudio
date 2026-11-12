import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/http";
import { systemStatus } from "@/server/status";
import { Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Status" };
export const dynamic = "force-dynamic";

const DOT = { true: "bg-ok", false: "bg-bad", null: "bg-muted" } as const;

export default async function StatusPage() {
  const user = await currentUser();
  if (!user?.isAdmin) notFound();
  const s = await systemStatus();
  const bad = s.checks.filter((c) => c.ok === false).length;
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title="System status"
        sub={bad ? `${bad} problem${bad > 1 ? "s" : ""} need attention` : "Everything looks healthy"}
        actions={<div className="flex gap-3 text-sm"><Link href="/admin/status" className="text-accent">Refresh</Link><Link href="/admin" className="text-muted hover:text-ink">← Admin</Link></div>}
      />
      <Card>
        <ul className="divide-y divide-line">
          {s.checks.map((c) => (
            <li key={c.name} className="flex items-start gap-3 py-3">
              <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${DOT[String(c.ok) as "true" | "false" | "null"]}`} />
              <div>
                <p className="font-medium">{c.name} <span className="sr-only">{c.ok === null ? "not set up" : c.ok ? "OK" : "problem"}</span></p>
                <p className="text-sm text-muted">{c.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">{s.appEnv} · {s.appUrl} · grey = not set up / not applicable</p>
      </Card>
      <Card>
        <h2 className="font-semibold">Recent alerts</h2>
        <p className="mt-1 text-xs text-muted">Emailed to ADMIN_EMAILS (repeats muted per alert type; see alert_cooldown_minutes in Admin → Operations).</p>
        {s.alerts.length === 0 ? <p className="mt-3 text-sm text-muted">No alerts.</p> : (
          <ul className="mt-3 space-y-3">
            {s.alerts.map((a, i) => (
              <li key={i} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-medium">{a.subject}</p>
                <p className="mt-1 text-muted">{a.body}</p>
                <p className="mt-1 text-xs text-muted">{new Date(a.created_at).toLocaleString()} · {a.emailed ? "emailed" : "not emailed (muted)"}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
