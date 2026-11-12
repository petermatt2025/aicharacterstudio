import { route, requireUser } from "@/server/http";
import { changePlan } from "@/server/billing";

export const POST = route(async (req) => changePlan(await requireUser(req), await req.json()));
