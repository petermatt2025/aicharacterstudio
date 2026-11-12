import { route, requireUser } from "@/server/http";
import { deleteCampaign, getCampaign, updateCampaign } from "@/server/campaigns";

type P = { id: string };
export const GET = route<P>(async (req, { params }) => ({ campaign: await getCampaign(await requireUser(req), (await params).id) }));
export const PATCH = route<P>(async (req, { params }) => ({ campaign: await updateCampaign(await requireUser(req), (await params).id, await req.json()) }));
export const DELETE = route<P>(async (req, { params }) => deleteCampaign(await requireUser(req), (await params).id));
