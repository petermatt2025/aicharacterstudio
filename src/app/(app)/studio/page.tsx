import Link from "next/link";
import { currentUser } from "@/server/http";
import { featureAccess, listFeatures } from "@/server/entitlements";
import { STUDIOS } from "@/lib/catalog";
import { Badge, PageHeader, cx } from "@/components/ui";

export const metadata = { title: "Studio" };

export default async function Studio() {
  const user = (await currentUser())!;
  const features = await listFeatures();
  const withAccess = await Promise.all(features.map(async (f) => ({ f, access: await featureAccess(user, f) })));
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Studio" sub={`All ${features.filter((f) => f.tool_number).length} tools across six studios. Only Beta and Live tools can run; the rest show their roadmap status.`} />
      <div className="space-y-10">
        {STUDIOS.map((s) => (
          <section key={s.key} aria-labelledby={`studio-${s.key}`}>
            <h2 id={`studio-${s.key}`} className="text-lg font-semibold">{s.name}</h2>
            <p className="text-sm text-muted">{s.blurb}</p>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {withAccess.filter(({ f }) => f.studio === s.key).map(({ f, access }) => {
                const usable = access.ok;
                return (
                  <li key={f.key}>
                    <Link href={`/studio/${f.key}`} className={cx("block h-full rounded-2xl border bg-surface p-4", usable ? "border-line hover:border-accent/60" : "border-line/60 opacity-80")}>
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium">{f.tool_number ? <span className="mr-1 text-muted">{String(f.tool_number).padStart(2, "0")}</span> : null}{f.name}</span>
                        <Badge tone={f.release_state} />
                      </div>
                      <p className="mt-2 text-sm text-muted">{f.description}</p>
                      <p className="mt-3 text-xs text-muted">
                        <span className="capitalize">{f.min_tier}</span>+ plan{!usable && (access.reason === "plan_required" || access.reason === "beta_only") ? ` · ${access.message}` : ""}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
