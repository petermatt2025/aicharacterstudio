import { route, requireUser } from "@/server/http";
import { deleteAsset, getAsset, updateAsset } from "@/server/assets";
import { assetView as view } from "@/server/views";

export const GET = route<{ id: string }>(async (req, { params }) => ({ asset: view(await getAsset(await requireUser(req), (await params).id)) }));
export const PATCH = route<{ id: string }>(async (req, { params }) => ({ asset: view(await updateAsset(await requireUser(req), (await params).id, await req.json())) }));
export const DELETE = route<{ id: string }>(async (req, { params }) => deleteAsset(await requireUser(req), (await params).id));
