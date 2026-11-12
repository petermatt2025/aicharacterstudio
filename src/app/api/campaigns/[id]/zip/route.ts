import { route, requireUser } from "@/server/http";
import { campaignZip } from "@/server/campaigns";

export const GET = route<{ id: string }>(async (req, { params }) => {
  const { buf, filename } = await campaignZip(await requireUser(req), (await params).id);
  return new Response(buf as unknown as BodyInit, { headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "private, no-store" } });
});
