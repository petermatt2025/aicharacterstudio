import { route, requireUser, publicBaseUrl } from "@/server/http";
import { createSubscriptionCheckout } from "@/server/billing";

export const POST = route(async (req) => createSubscriptionCheckout(await requireUser(req), await req.json(), publicBaseUrl(req)));
