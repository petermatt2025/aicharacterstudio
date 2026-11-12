import { currentUser } from "@/server/http";
import { listAssets } from "@/server/assets";
import { assetView } from "@/server/views";
import { PageHeader } from "@/components/ui";
import { TextPicker } from "@/components/text-picker";

export const metadata = { title: "Text Studio" };

export default async function TextIndex() {
  const user = (await currentUser())!;
  const assets = await listAssets(user, { limit: 100 });
  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Text Studio" sub="Add exact, editable text to any image: pick one you created, one you uploaded, or upload a new photo. Free, no credits." />
      <TextPicker assets={assets.map((a) => JSON.parse(JSON.stringify(assetView(a))))} emailVerified={user.emailVerified} />
    </div>
  );
}
