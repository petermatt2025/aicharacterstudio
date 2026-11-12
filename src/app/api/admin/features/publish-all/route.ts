import { route, requireUser } from "@/server/http";
import { publishAllBetaTools } from "@/server/admin";

export const POST = route(async (req) => publishAllBetaTools(await requireUser(req)));
