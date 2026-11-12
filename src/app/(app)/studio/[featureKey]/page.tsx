import Link from "next/link";
import { notFound } from "next/navigation";
import { currentUser } from "@/server/http";
import { featureAccess, getFeature } from "@/server/entitlements";
import { listAssets, listCharacters } from "@/server/assets";
import { assetView } from "@/server/views";
import { TOOLS } from "@/lib/tools";
import { Badge, ButtonLink, Card, PageHeader } from "@/components/ui";
import { StudioShell } from "@/components/studio-shell";
import { AppError } from "@/server/errors";
import { availableEngines, ENGINE_INFO } from "@/server/providers";

export default async function ToolPage({ params }: { params: Promise<{ featureKey: string }> }) {
  const { featureKey } = await params;
  const user = (await currentUser())!;
  const f = await getFeature(featureKey).catch((e) => (e instanceof AppError ? null : Promise.reject(e)));
  if (!f) notFound();
  const tool = TOOLS[f.key];
  const access = await featureAccess(user, f);

  if (!tool || f.release_state === "planned" || f.release_state === "coming_soon") {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title={f.name} sub={f.description} />
        <Card className="space-y-3">
          <Badge tone={f.release_state} />
          <p className="text-sm text-muted">
            This tool is {f.release_state === "planned" ? "on the roadmap" : "coming soon"} (phase {f.phase}). It is not part of any current purchase and cannot generate images yet.
            It will require the <span className="capitalize">{f.min_tier}</span> plan or higher when it launches.
          </p>
          <ButtonLink href="/studio" variant="secondary">Back to studio</ButtonLink>
        </Card>
      </div>
    );
  }

  const [characters, assets] = await Promise.all([listCharacters(user), listAssets(user, { limit: 100 })]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader
        title={tool.title}
        sub={tool.tagline}
        actions={<div className="flex items-center gap-2"><Badge tone={f.release_state} /><Link href="/studio" className="text-sm text-muted hover:text-ink">All tools</Link></div>}
      />
      <details className="mb-6 rounded-2xl border border-line bg-surface p-4 text-sm">
        <summary className="cursor-pointer font-medium">How to use this tool</summary>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          <ol className="list-decimal space-y-1 pl-5 text-muted">{tool.instructions.map((i) => <li key={i}>{i}</li>)}</ol>
          <div>
            <p className="font-medium">Example uses</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-muted">{tool.examples.map((i) => <li key={i}>{i}</li>)}</ul>
          </div>
        </div>
      </details>
      <StudioShell
        tool={tool}
        access={access}
        emailVerified={user.emailVerified}
        engines={availableEngines().map((key) => ({ key, ...ENGINE_INFO[key] }))}
        characters={characters.map((c) => ({ id: c.id, name: c.name, primary_asset_id: c.primary_asset_id, identity_strength: c.identity_strength }))}
        initialAssets={assets.filter((a) => a.kind !== "output").map((a) => JSON.parse(JSON.stringify(assetView(a))))}
      />
    </div>
  );
}
