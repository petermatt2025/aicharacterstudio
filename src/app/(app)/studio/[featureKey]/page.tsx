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
import { ImageToPrompt } from "@/components/image-to-prompt";
import { listBoards } from "@/server/style-boards";
import { availableEngines, ENGINE_INFO } from "@/server/providers";

export default async function ToolPage({ params, searchParams }: { params: Promise<{ featureKey: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { featureKey } = await params;
  const sp = await searchParams;
  const user = (await currentUser())!;
  const f = await getFeature(featureKey).catch((e) => (e instanceof AppError ? null : Promise.reject(e)));
  if (!f) notFound();
  const tool = TOOLS[f.key];
  const access = await featureAccess(user, f);

  if (f.key === "image_to_prompt" && f.release_state !== "planned" && f.release_state !== "coming_soon") {
    const assets = await listAssets(user, { limit: 100 });
    return (
      <div className="mx-auto max-w-6xl">
        <PageHeader title={f.name} sub="Turn any image into a detailed, editable prompt, then use it in any tool." actions={<div className="flex items-center gap-2"><Badge tone={f.release_state} /><Link href="/studio" className="text-sm text-muted hover:text-ink">All tools</Link></div>} />
        <ImageToPrompt
          initialAssets={assets.map((a) => JSON.parse(JSON.stringify(assetView(a))))}
          tools={Object.values(TOOLS).filter((t) => t.key !== "image_edit").map((t) => ({ key: t.key, title: t.title }))}
          disabledReason={!user.emailVerified ? "Verify your email first." : access.ok ? null : access.message}
          initialSource={typeof sp.source === "string" ? sp.source : undefined}
        />
      </div>
    );
  }

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

  const [characters, assets, boards] = await Promise.all([listCharacters(user), listAssets(user, { limit: 100 }), listBoards(user)]);
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
        initialAssets={assets.filter((a) => a.kind !== "output" || tool.slots.some((sl) => sl.pickOutputs)).map((a) => JSON.parse(JSON.stringify(assetView(a))))}
        styleBoards={boards.map((b) => ({ id: b.id, name: b.name, count: b.asset_ids.length, thumbs: b.asset_ids.slice(0, 3) }))}
        initialStyleBoard={typeof sp.style === "string" ? sp.style : undefined}
        initialPrompt={typeof sp.prompt === "string" ? sp.prompt.slice(0, 2000) : undefined}
        initialPresets={typeof sp.preset === "string" && tool.presets.some((pr) => pr.key === sp.preset) ? [sp.preset] : undefined}
        initialSlots={(() => {
          // "Edit" from the Gallery: preselect the image (only if it is one of this user's assets).
          const src = typeof sp.source === "string" ? sp.source : null;
          const slot = tool.slots.find((sl) => sl.pickOutputs);
          return src && slot && assets.some((a) => a.id === src) ? { [slot.role]: src } : {};
        })()}
      />
    </div>
  );
}
