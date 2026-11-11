import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/server/http";
import { getBalance } from "@/server/credits";
import { listJobs } from "@/server/generation";
import { featureAccess, listFeatures } from "@/server/entitlements";
import { one } from "@/server/db";
import { TOOLS } from "@/lib/tools";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { VerifyBanner } from "@/components/verify-banner";

export const metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const user = (await currentUser())!;
  if (!user.onboarded) redirect("/onboarding");
  const [credits, jobs, features, stats] = await Promise.all([
    getBalance(user.workspaceId),
    listJobs(user, 8),
    listFeatures(),
    one<{ images: number; characters: number }>(
      `SELECT (SELECT count(*)::int FROM assets WHERE workspace_id=$1 AND kind='output' AND deleted_at IS NULL) AS images,
              (SELECT count(*)::int FROM character_profiles WHERE workspace_id=$1 AND deleted_at IS NULL) AS characters`,
      [user.workspaceId],
    ),
  ]);
  const quick = await Promise.all(features.filter((f) => TOOLS[f.key]).map(async (f) => ({ f, access: await featureAccess(user, f) })));
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader title={`Welcome${user.displayName ? `, ${user.displayName}` : ""}`} sub="Create from your saved characters and references." actions={<ButtonLink href="/studio">Open studio</ButtonLink>} />
      {!user.emailVerified && <VerifyBanner />}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-sm text-muted">Credits available</p>
          <p className="mt-1 text-3xl font-semibold">{credits.balance}</p>
          {credits.reserved > 0 && <p className="text-xs text-muted">{credits.reserved} reserved for running jobs</p>}
          {credits.nextExpiry && <p className="text-xs text-muted">{credits.nextExpiry.amount} expire {new Date(credits.nextExpiry.at).toLocaleDateString()}</p>}
          <ButtonLink href={user.planKey === "free" ? "/pricing" : "/billing"} variant="secondary" className="mt-3">{user.planKey === "free" ? "Upgrade" : "Top up"}</ButtonLink>
        </Card>
        <Card>
          <p className="text-sm text-muted">Images created</p>
          <p className="mt-1 text-3xl font-semibold">{stats!.images}</p>
          <Link href="/gallery" className="mt-3 inline-block text-sm text-accent">Open gallery</Link>
        </Card>
        <Card>
          <p className="text-sm text-muted">Saved characters</p>
          <p className="mt-1 text-3xl font-semibold">{stats!.characters}</p>
          <Link href="/library" className="mt-3 inline-block text-sm text-accent">Manage library</Link>
        </Card>
      </div>

      <section>
        <h2 className="mb-3 font-semibold">Quick start</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {quick.map(({ f, access }) => (
            <Link key={f.key} href={`/studio/${f.key}`} className="rounded-2xl border border-line bg-surface p-4 hover:border-accent/60">
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{TOOLS[f.key]!.title}</span></div>
              <p className="mt-1 text-xs text-muted">{TOOLS[f.key]!.tagline}</p>
              <p className="mt-2">{access.ok ? <Badge tone={f.release_state} /> : <span className="text-xs text-warn">{access.message}</span>}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">Recent generations</h2>
        {jobs.length === 0 ? (
          <Card className="text-sm text-muted">No generations yet. <Link href="/studio" className="text-accent">Start your first one.</Link></Card>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {jobs.map((j) => (
              <li key={j.id}>
                <Card className="p-3">
                  {j.first_output ? <img src={`/api/assets/${j.first_output}/file?variant=thumb`} alt="" className="aspect-square w-full rounded-lg object-cover" /> : <div className="grid aspect-square place-items-center rounded-lg bg-surface-2 text-xs text-muted">{j.status}</div>}
                  <p className="mt-2 text-sm">{TOOLS[j.feature_key]?.title ?? j.feature_key}</p>
                  <p className="text-xs text-muted">{j.outputs_delivered}/{j.outputs_requested} · {j.status} · {j.credits_charged || j.credits_reserved} cr</p>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
