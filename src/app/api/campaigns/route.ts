import { route, requireUser } from "@/server/http";
import { createCampaign, listCampaigns } from "@/server/campaigns";

export const GET = route(async (req) => ({ campaigns: await listCampaigns(await requireUser(req)) }));
export const POST = route(async (req) => ({ campaign: await createCampaign(await requireUser(req), await req.json()) }));
