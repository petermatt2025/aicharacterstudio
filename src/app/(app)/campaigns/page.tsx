import { currentUser } from "@/server/http";
import { listCampaigns } from "@/server/campaigns";
import { PageHeader } from "@/components/ui";
import { CampaignList } from "@/components/campaigns";

export const metadata = { title: "Campaigns" };

export default async function Campaigns() {
  const user = (await currentUser())!;
  const list = await listCampaigns(user);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Campaigns" sub="Folders for your projects: keep a brief, collect images, generate straight into them and download everything as a ZIP." />
      <CampaignList initial={list.map((c) => ({ id: c.id, name: c.name, brief: c.brief, count: c.item_count, covers: c.cover_ids }))} />
    </div>
  );
}
