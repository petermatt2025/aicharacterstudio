import { route, requireUser, publicBaseUrl } from "@/server/http";
import { createPortalSession } from "@/server/billing";

export const POST = route(async (req) => createPortalSession(await requireUser(req), publicBaseUrl(req)));
