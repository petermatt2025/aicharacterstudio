import { route, requireUser } from "@/server/http";
import { addToCampaign, removeFromCampaign } from "@/server/campaigns";

type P = { id: string };
// POST {assetIds} adds; DELETE {assetIds} removes (the images stay in the gallery).
export const POST = route<P>(async (req, { params }) => ({ campaign: await addToCampaign(await requireUser(req), (await params).id, ((await req.json()) as { assetIds: string[] }).assetIds) }));
export const DELETE = route<P>(async (req, { params }) => ({ campaign: await removeFromCampaign(await requireUser(req), (await params).id, ((await req.json()) as { assetIds: string[] }).assetIds) }));
