import { route, requireUser } from "@/server/http";
import { createPortalSession } from "@/server/billing";

export const POST = route(async (req) => createPortalSession(await requireUser(req)));
