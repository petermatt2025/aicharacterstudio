import { route, requireUser } from "@/server/http";
import { patchPlan } from "@/server/admin";

export const PATCH = route<{ key: string }>(async (req, { params }) => ({ plan: await patchPlan(await requireUser(req), (await params).key, await req.json()) }));
