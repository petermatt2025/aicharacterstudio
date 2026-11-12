import { notFound } from "next/navigation";
import { currentUser } from "@/server/http";
import { getCampaign } from "@/server/campaigns";
import { listAssets } from "@/server/assets";
import { assetView } from "@/server/views";
import { AppError } from "@/server/errors";
import { CampaignDetail } from "@/components/campaigns";

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const user = (await currentUser())!;
  const c = await getCampaign(user, (await params).id).catch((e) => (e instanceof AppError ? null : Promise.reject(e)));
  if (!c) notFound();
  const assets = await listAssets(user, { limit: 100 });
  return (
    <div className="mx-auto max-w-7xl">
      <CampaignDetail
        campaign={{ id: c.id, name: c.name, brief: c.brief, assetIds: c.asset_ids }}
        library={assets.filter((a) => a.kind === "output").map((a) => JSON.parse(JSON.stringify(assetView(a))))}
      />
    </div>
  );
}
