import { currentUser } from "@/server/http";
import { listBoards } from "@/server/style-boards";
import { listAssets } from "@/server/assets";
import { assetView } from "@/server/views";
import { PageHeader } from "@/components/ui";
import { StyleBoards } from "@/components/style-boards";

export default async function StylesPage() {
  const user = (await currentUser())!;
  const [boards, assets] = await Promise.all([listBoards(user), listAssets(user, { limit: 100 })]);
  return (
    <div className="mx-auto max-w-7xl">
      <PageHeader title="Style boards" sub="Collect images to define a look, then apply it to any tool or to images you already made." />
      <StyleBoards
        initialBoards={boards.map((b) => ({ id: b.id, name: b.name, description: b.description, assetIds: b.asset_ids }))}
        initialAssets={assets.filter((a) => (a.kind === "output" || a.kind === "style") && !a.mime.startsWith("video/")).map((a) => JSON.parse(JSON.stringify(assetView(a))))}
      />
    </div>
  );
}
