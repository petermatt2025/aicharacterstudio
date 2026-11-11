import { route, requireUser } from "@/server/http";
import { getBalance } from "@/server/credits";

export const GET = route(async (req) => getBalance((await requireUser(req)).workspaceId));
