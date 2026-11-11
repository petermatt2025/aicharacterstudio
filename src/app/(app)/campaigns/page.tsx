import { Badge, Card, PageHeader } from "@/components/ui";

export const metadata = { title: "Campaigns" };

export default function Campaigns() {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Campaigns" sub="Group assets, shot lists and batches." />
      <Card className="space-y-2">
        <Badge tone="planned" />
        <p className="text-sm text-muted">Campaign folders and batch generation arrive with the Marketing (phase 3) and Agency (phase 4) releases. Until then, use the gallery filters to group your images.</p>
      </Card>
    </div>
  );
}
