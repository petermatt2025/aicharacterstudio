import { route, requireUser } from "@/server/http";
import { syncStripePrices } from "@/server/billing";

export const POST = route(async (req) => syncStripePrices(await requireUser(req)));
