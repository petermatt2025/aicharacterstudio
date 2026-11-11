import { route, requireUser } from "@/server/http";
import { patchFeature } from "@/server/admin";

export const PATCH = route<{ key: string }>(async (req, { params }) => ({ feature: await patchFeature(await requireUser(req), (await params).key, await req.json()) }));
